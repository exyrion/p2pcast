module.exports = function(grunt) {

	grunt.config.set('browserify', {
		compile: {
			src: 'assets/js/app.js',
			dest: '.tmp/public/js/bundle.js',
			options: {
				transform: ['deamdify', 'deglobalify']
			}
		}
	});

	grunt.loadNpmTasks('grunt-browserify');
};
