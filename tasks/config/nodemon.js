module.exports = function(grunt) {

	grunt.config.set('nodemon', {
		dev: {
			script: 'app.js',
			options: {
				watch: ['api', 'config'],
				delayTime: 1
			}
		}
	});

	grunt.loadNpmTasks('grunt-nodemon');
};
