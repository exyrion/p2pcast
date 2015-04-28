// Javascript for channel page/partials
/*
$( "#localVideoContainer" ).click(function() {
      $( "#addVideo" ).click();
});
*/

// Channel management dialog box
$('#modifyChannel').on('click',function() {
  $('#channelModify').modal('show');
  var name = $(this).data('channel-name');
  var description = $(this).data('channel-description');
  var id = $(this).data('channel-id');
  $('#channelName').val(name);
  $('#channelDescription').val(description);

  //add the channel id to the action
  $('#updateChannelForm').attr('action','/channel/update/' + id);
});
