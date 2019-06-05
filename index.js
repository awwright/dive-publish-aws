
"use strict";

const mapPromise = require('bluebird').map;

exports.run = uploadResources;
async function uploadResources(app, s3, bucket, base, prefix, pretend){
	if(!bucket) throw new Error('bucket argument required');

	var resources = await app.listing();
	// TODO: request the default 404 error document,
	// Verify it's not a resource defined by this,
	// Then render the 404 page and upload it to that filename.
	// This will have the effect of adding a URI that 200's, but that's probably OK.
	var websiteInformation = await s3.getBucketWebsite({Bucket: bucket}).promise();
	console.log(websiteInformation);

	function writeResource(rsc){
		var uri = rsc.uri;
		var path = uri.substring(base.length);
		// But require that the filepath identifies a directory
		if(path[0]!='/') return;
		if(path[path.length-1]==='/') return;
		var key = prefix + path.substring(1);
		// console.log(`${uri} -> ${key}`);
		// If --pretend is specified, bail as late as possible (which is here)
		if(pretend){
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
					Bucket: bucket,
					Key: key,
					Body: res.body,
					ContentType: ct,
				}).promise().then(function(op){
					console.log(statusCode, uri, op);
					return `${statusCode} ${uri}`;
				});
			}else{
				console.error('Status code '+statusCode);
				throw new Error(statusCode+' <'+uri+'>');
			}
		});
	}

	return await mapPromise(resources.filter(function(resource){
		// Strip trailing slash, if any
		return resource.uri.substring(0, base.length)===base;
	}), writeResource, {concurrency: 10});
}
