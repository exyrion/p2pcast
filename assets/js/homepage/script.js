// for handling displaying the register dropdown when non register uses click broadcast button
$(document).ready( function(){
  // Open broadcast modal dialog
  $('#openBroadcastModal').click(function() {
    $('#broadcastModal').modal('show');
  });
  // If anonymous user clicks 'Broadcast Now' button on homepage, show login modal
  $('#goToLogin').click(function() {
    $('#openLoginModal').click();
  });
  // If user clicks Register from login modal, dimiss and bring up register modal
  $('#goToRegister').click(function() {
    $('#loginModal').modal('hide');
    $('#openRegisterModal').click();
  });

  $('#broadcastModal').on('shown.bs.modal', function () {
    $('#name').focus();
  });

});