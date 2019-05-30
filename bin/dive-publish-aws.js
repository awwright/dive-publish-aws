"use strict";

const path = require('path');

const args = require('commander');
const AWS = require('aws-sdk');
const https = require('https');

const run = require('../index.js').run;

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

var s3bucket = args.bucket || process.env.AWS_S3_BUCKET;
var awsProfile = args.profile || process.env.AWS_PROFILE;

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

if(awsProfile){
	AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: awsProfile});
}
const agent = new https.Agent({keepAlive: true});
AWS.config.httpOptions.agent = agent;
var S3 = new AWS.S3();

run(app, S3, s3bucket, base, prefix, args.pretend).catch(function(err){
	console.error(err);
}).then(function(){
	agent.destroy();
});
