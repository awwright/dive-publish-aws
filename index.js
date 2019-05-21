

module.exports.Servers = {
	s3: ServeS3,
};

function ServeS3(app, args, conf){
	var resources = [];
	return app.listing().then(function(list){
		// console.log(route.template, list);
		list.forEach(function(uri){
			resources.push(uri);
		});
	}).then(function(){
		// console.log(resources);
		uploadResources(resources);
	});
}
