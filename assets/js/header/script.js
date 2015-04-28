/* ---- Javascript for header partial ---- */
//
$('#browse').click(function() {
	$('#browse').addClass();
});

// Handle logout redirect
$('#logout').click(function() {
 $.post(
  '/logout',
    function(){
      location.reload(true);
    }
  );
});

// Open login modal dialog
$('#openLoginModal').click(function() {
	$('#loginModal').modal('show');
	$('.form-group').removeClass('has-error');
	$('.alert').addClass('hidden');
	$('.modal-content').width(400);
  
	$(':checkbox').on('click', function() {
  		$(':checkbox').checkbox('toggle');
	});
});

// Toggle dropdown to show flash message if there was a problem with login
if($('#flashLogin').text().length > 0){
  $('#openLoginModal').trigger("click");
  $('.form-group').addClass('has-error');
  $('.alert').removeClass('hidden');
}

// Focus on first input field on open
$('#loginModal').on('shown.bs.modal', function () {
    $('#email').focus();
});

// Open register modal dialog
$('#openRegisterModal').click(function() {
  $('#registerModal').modal('show');
  $('.form-group').removeClass('has-error');
  $('.alert').addClass('hidden');
  $('.modal-content').width(400);
});

// Toggle dropdown to show flash message if there was a problem with registration
if($('#flashRegister').text().length > 0){
  $('#openRegisterModal').trigger("click");
  $('.form-group').addClass('has-error');
  $('.alert').removeClass('hidden');
}

// Focus on first input field on open
$('#registerModal').on('shown.bs.modal', function () {
    $('#newName').focus();
});






