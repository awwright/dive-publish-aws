"use strict";

const path = require('path');
const mapPromise = require('bluebird').map;

const args = require('commander');
const AWS = require('aws-sdk');

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

/*
0. If fixScheme and fixAuthority is set:
	 if fixAutority is nonempty, default the `base` to {scheme}://{authority}
	 else, default the base to {scheme}:{authority}
1. get AWS storage configuration to determine 404 file name
	- if any, determine if error file shadows an existing resource
	- If not, the render the default 404 route and upload it to this filename
2. enumerate resources, and for each resource:
	- Rewrite base URI to bucket+prefix
	- Determine if file contents has changed
	- If our last-modified is more recent than the remote's, upload new file
	- (If available, use If-Unmodified-Since)
*/

const app = require(path.resolve(args.args[0]));

const argbase = args.base && args.base[args.base.length-1]=='/' ? args.base.substring(0, args.base.length-1) : args.base ;
const defaultBase = (function(){
	if(typeof app.fixedScheme==='string' && typeof app.fixedAuthority==='string'){
		return app.fixedScheme + ':' + (app.fixedAuthority ? '//' : '') + app.fixedAuthority;
	}else{
		return 'http://localhost';
	}
})();
const base = argbase || defaultBase;
const prefix = typeof args.key=='string' ? args.key : '';

if(args.profile){
	var credentials = new AWS.SharedIniFileCredentials({profile: args.profile});
	AWS.config.credentials = credentials;
}

app.listing().then(function(resources){
	var s3 = new AWS.S3();
	s3.getBucketWebsite({Bucket: args.bucket}).promise().then(function(websiteInformation){
		console.log(websiteInformation);
		function writeResource(uri){
			var path = uri.substring(base.length);
			// But require that the filepath identifies a directory
			if(path[0]!='/') return;
			if(path[path.length-1]==='/') return;
			var key = prefix + path.substring(1);
			console.log(`${uri} -> ${key}`);
			return app.prepare(uri).then(function(rsc){
				// If --pretend is specified, bail as late as possible (which is here)
				if(args.pretend){
					return;
				}
				var req = {
					headers: {
						Accept: 'application/xhtml+xml',
					}
				};
				return rsc.renderString(req).then(function(res){
					var ct = res.getHeader('Content-Type');
					var statusCode = res.statusCode || 200;
					if(statusCode===200 && ct.length){
						return s3.putObject({
							Bucket: args.bucket,
							Key: key,
							Body: res.body,
							ContentType: ct,
						}).promise().then(function(op){
							console.log(res.statusCode, uri, op);
							return `${res.statusCode} ${uri}`;
						});
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
});
