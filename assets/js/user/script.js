// Change color of flash message based on status of updated info
if($('#flash').text() == "update failed" ) {
  if($('#flash').hasClass('alert-success')) {
    $('#flash').removeClass('alert-success');
  }
  $('#flash').addClass('alert-danger');
} else {
  if($('#flash').hasClass('alert-danger')){
    $('#flash').removeClass('alert-danger');
  }
  $('#flash').addClass('alert-success');
}

// Channel management dialog box
$('.modifyChannel').click(function(e) {
  $('#channelModify').modal('show');
  //console.log($(this).data('channel-name'));
  var name = $(this).data('channel-name');
  var description = $(this).data('channel-description');
  var id = $(this).data('channel-id');
  $('#channelName').val(name);
  $('#channelDescription').val(description);

  //add the channel id to the action
  $('#updateChannelForm').attr('action','/channel/update/' + id);
});

// Channel delete confirmation modal
$('.deleteForm').submit(function(e) {
  e.preventDefault();
  var form = $(this);
  $('#channelDelete').modal('show');
  $('#confirmDelete').click(function(e) {
    form.unbind('submit');
    form.submit();
  });
});