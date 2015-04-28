module.exports = function(grunt) {

	grunt.config.set('concurrent', {
		target: {
			tasks: ['nodemon', 'watch'],
			options: {
				logConcurrentOutput: true
			}
		}
	});

	grunt.loadNpmTasks('grunt-concurrent');
};
