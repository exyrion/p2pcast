module.exports = function (grunt) {
	grunt.registerTask('compileAssets', [
		'clean:dev',
		'jst:dev',
		'less:dev',
		'coffee:dev',
                'browserify:compile',
                'copy:dev'
	]);
};
