"use strict";

const path = require('path');
const { inherits } = require('util');
const mapPromise = require('bluebird').map;

const args = require('commander');
const AWS = require('aws-sdk');
const { handleRequest } = require('dive-httpd');
const { ServerResponseTransform, ServerResponsePassThrough } = require('http-transform');

process.on("unhandledRejection", function(){
	console.error(arguments);
});

args.usage('[options] <app.js>', 'Run <app> and export resources to an AWS S3 bucket');
args.option('--profile <name>', 'Use AWS credentials from given profile name');
args.option('--bucket <name>', 'AWS bucket name to save to');
args.option('--key <name>', 'Key prefix to use in bucket');
args.option('--base <name>', 'Website base');
args.option('--pretend', 'Stop short of uploading, just print results');
//args.option('--delete', 'Delete all other resources under the base');
args.parse(process.argv);

if (args.args.length !== 1) return void args.help();

const app = require(path.resolve(args.args[0]));

const argbase = args.base && args.base[args.base.length-1]=='/' ? args.base.substring(0, args.base.length-1) : args.base ;
const base = argbase || 'http://localhost';
const prefix = typeof args.key=='string' ? args.key : '';

inherits(ReadResponse, ServerResponseTransform);
function ReadResponse(options){
	if(!(this instanceof ReadResponse)) return new ReadResponse(options);
	ServerResponseTransform.call(this, options);
	this.body = '';
};
ReadResponse.prototype.name = 'ReadResponse';
ReadResponse.prototype._transformHead = function _transformHead(headers){ return headers; };
ReadResponse.prototype._transform = function _transform(data, encoding, callback){
	// Buffer incoming ReadResponse data
	this.body += data;
	callback(null, data, encoding);
};
ReadResponse.prototype._flush = function _flush(callback){
	// Render the ReadResponse to HTML and push out trailers
	callback();
};

app.listing().then(function(resources){
	// console.log(resources);
	uploadResources(resources);
});

if(args.profile){
	var credentials = new AWS.SharedIniFileCredentials({profile: 'work-account'});
	AWS.config.credentials = credentials;
}

function uploadResources(resources){

	var s3 = new AWS.S3();

	s3.getBucketWebsite({Bucket: args.bucket}).promise().then(function(websiteInformation){
		console.log(websiteInformation);
		function writeResource(uri){
			var path = uri.substring(base.length);
			// But require that the filepath identifies a directory
			if(path[0]!='/') return;
			if(path[path.length-1]==='/') return;
			var key = prefix + path.substring(1);
			var req = {
				url: uri,
				method: 'GET',
				headers: {},
			};
			console.log(`${uri} -> ${key}`);
			var res = new ReadResponse;
			handleRequest(app, req, res);
			return new Promise(function(resolve, reject){
				// If --pretend is specified, bail as late as possible (which is here)
				if(args.pretend) return void resolve();
				res.on('data', function(){
					// This is required or everything breaks for some reason
				});
				res.on('end', function(){
					var ct = res.getHeader('Content-Type');
					var statusCode = res.statusCode || 200;
					if(statusCode===200 && ct.length){
						s3.putObject({
							Bucket: args.bucket,
							Key: key,
							Body: res.body,
							ContentType: ct,
						}).promise().then(function(op){
							console.log(res.statusCode, uri, op);
							return `${res.statusCode} ${uri}`;
						}).then(resolve);
					}else{
						console.error('Status code '+res.statusCode);
						reject([uri, res.statusCode]);
					}
				});
			});
		}
		return mapPromise(resources.filter(function(uri){
			// Strip trailing slash, if any
			return uri.substring(0, base.length)===base;
		}), writeResource, {concurrency: 10});
	//	return Promise.all(resources.filter(function(uri){
	//		// Strip trailing slash, if any
	//		return uri.substring(0, base.length)===base;
	//	}).map(writeResource));
	}).then(function(uploaded){
		if(args.invalidate){
			// Send an invalidation request to AWS CloudFront
			// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudFront.html#createInvalidation-property
			var params = {
				DistributionId: 'STRING_VALUE', /* required */
				InvalidationBatch: { /* required */
					CallerReference: 'STRING_VALUE', /* required */
					Paths: { /* required */
						Quantity: 0, /* required */
						Items: uploaded.map(function(v){ return v }),
					}
				}
			};
			cloudfront.createInvalidation(params, function(err, data) {
				if (err) console.log(err, err.stack); // an error occurred
				else console.log(data);           // successful response
			});
			console.log('done', arguments);
		}
	}).catch(function(){
		console.error('finally', arguments);
	});
}
