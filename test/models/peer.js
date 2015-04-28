describe('Peer', function() {
  describe('#create()', function() {

    it('should throw if you create an empty peer', function(done) {
      Peer.create().exec(function(err, peer) {
	expect(err).to.exist;
	done();
      });
    });

  });

  describe('#canRebroadcast()', function() {

    it('should allow rebroadcasting if it is a broadcaster', function(done) {
      Peer.findOneById(1).populate('parent').exec(function(err, peer) {
	expect(err).to.not.exist;
	expect(peer).to.exist;
	peer.canRebroadcast().should.be.true;
	done();
      });
    });

    it('should allow rebroadcasting if parent link is established', function(done) {
      Peer.findOneById(2).populate('parent').exec(function(err, peer) {
        expect(err).to.not.exist;
        expect(peer).to.exist;
        peer.canRebroadcast().should.be.true;
        done();
      });
    });

    it('should not allow rebroadcasting if parent link is connecting', function(done) {
      Peer.findOneBySocketID('dummy4').populate('parent').exec(function(err, peer) {
        expect(err).to.not.exist;
        expect(peer).to.exist;
        peer.canRebroadcast().should.be.false;
        done();
      });
    });

    it('should not allow rebroadcasting if parent link is only init established', function(done) {
      Peer.findOneBySocketID('dummy6').populate('parent').exec(function(err, peer) {
        expect(err).to.not.exist;
        expect(peer).to.exist;
        peer.canRebroadcast().should.be.false;
        done();
      });
    });

    it('should not allow rebroadcasting if parent link is only recv established', function(done) {
      Peer.findOneBySocketID('dummy8').populate('parent').exec(function(err, peer) {
        expect(err).to.not.exist;
        expect(peer).to.exist;
        peer.canRebroadcast().should.be.false;
        done();
      });
    });

  });

});
