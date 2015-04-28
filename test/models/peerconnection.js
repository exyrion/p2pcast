describe('PeerConnection', function() {
  describe('#create()', function() {

    it('should throw if you create an empty peer connection', function(done) {
      PeerConnection.create().exec(function(err, peer) {
	expect(err).to.exist;
	done();
      });
    });

  });

  describe('#getPeerEndpoint()', function() {

    it('should error if not given a peer', function(done) {
      PeerConnection.findOneById(1).populate('initiator').populate('receiver').exec(function(err, peerConn) {
	expect(err).to.not.exist;
	expect(peerConn).to.exist;

	peerConn.getPeerEndpoint('a string').then(function(remotePeer) {
	  expect(remotePeer).to.not.exist;
	  done();
	}).catch(function(e) {
	  expect(e).to.exist;
	  expect(e).to.be.an.instanceof(Error);
	  done();
	}).done();
      });
    });

    describe('returning peer endpoints', function() {
      var peer1, peer2;

      before(function(done) {
	Peer.findOneBySocketID('dummy1').populate('parent').populate('children').exec(function(err, peer) {
	  if (err) done(err);

	  peer1 = peer;
	  if (peer1 && peer2) done();
	});

        Peer.findOneBySocketID('dummy8').populate('parent').populate('children').exec(function(err, peer) {
          if (err) done(err);

          peer2 = peer;
          if (peer1 && peer2) done();
        });
      });

      it('should return the other end from one peer connection', function(done) {
        peer2.parent.getPeerEndpoint(peer2).then(function(endpointPeer) {
          expect(endpointPeer).to.exist;
          expect(endpointPeer.id).to.equal(1);
          done();
        }).catch(function(e) {
          expect(e).to.not.exist;
          done();
        }).done();
      });

      it('should return the exact opposite end going back', function(done) {
	var peer1child = _.filter(peer1.children, { id: peer2.id })[0];

	peer1child.getPeerEndpoint(peer1).then(function(endpointPeer) {
          expect(endpointPeer).to.exist;
          expect(endpointPeer.id).to.equal(8);
          done();
	}).catch(function(e) {
          expect(e).to.not.exist;
          done();
	}).done();
      });
    });

  });

});
