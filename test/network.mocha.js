
process.env.NODE_ENV='test';
process.env.DEBUG='network,api,lb';
process.env.ONLY_LOCAL=true;
process.env.NS='test:namespace';

var fs      = require('fs');
var network = require('../index.js');
var should  = require('should');
var path    = require('path');
var request = require('request');

describe('Network', function() {
  var n1, n2, n3;
  var sync_file_size;

  it('should create a first client', function(done) {
    n1 = new network({
      peer_api_port : 10000
    }, function() { done() });
  });

  it('should have the rigth namespace (via process.env.NS)', function(done) {
    should(n1._ns).eql('test:namespace');
    done();
  });

  it('should connect second client', function(done) {
    n2 = new network({
      peer_api_port  : 11000,
      tmp_file       : '/tmp/n2.tar.gz',
      tmp_folder     : '/tmp/n2'
    }, done);
  });

  it('n1 should list 1 peer', function(done) {
    should(n1.getPeers().length).eql(1);
    done();
  });

  it('n2 should list 1 peer', function(done) {
    should(n2.getPeers().length).eql(1);
    setTimeout(done, 1000);
  });

  describe('API Interactions', function() {

    it('should webserver be started', function(done) {
      request.get('http://localhost:10000/ping', function(err, res, body) {
        should(err).be.null;
        should(res.statusCode).eql(200);
        body.should.eql('pong');
        done();
      });
    });

    it('should retrieve two host connected', function(done) {
      request.get('http://localhost:10000/hosts/list', function(e, r, b) {
        var dt = JSON.parse(b);
        should(e).be.null;
        should(r.statusCode).eql(200);
        should(dt.length).eql(2);
        dt[0].should.have.properties(['ip', 'api_port', 'name', 'hostname', 'synchronized']);
        dt[0].synchronized.should.be.true;
        done();
      });
    });

    it('should retrieve 0 tasks started', function(done) {
      request.get('http://localhost:10000/tasks/list', function(err, res, body) {
        should(err).be.null;
        should(res.statusCode).eql(200);
        var tasks = JSON.parse(body);
        should(tasks.length).eql(0);
        done();
      });
    });



    it('should get configuration', function(done) {
      request.get('http://localhost:10000/conf', function(err, res, body) {
        should(err).be.null;
        should(res.statusCode).eql(200);
        var conf = JSON.parse(body);
        conf.should.have.properties(['file_manager', 'task_manager']);
        done();
      });
    });

    it('should start all fixtures tasks', function(done) {
      this.timeout(5000);
      var base_folder = path.join(__dirname, 'fixtures', 'app1');
      var task_folder = 'tasks';

      request.post('http://localhost:10000/tasks/init', {
        form : {
          base_folder : base_folder,
          task_folder : task_folder,
          instances   : 1,
          env         : {
            NODE_ENV : 'test'
          }
        }
      }, function(err, res, body) {
        var ret = JSON.parse(body);
        ret['echo'].task_id.should.eql('echo');
        ret['echo'].pm2_name.should.eql('task:echo');
        ret['ping'].task_id.should.eql('ping');

        n1.task_manager.getTasks().echo.port.should.eql(10001);

        // Wait 2 seconds before starting to process msg
        setTimeout(done, 1000);
      });
    });

    it('should RESTART all fixtures tasks', function(done) {
      this.timeout(5000);
      var base_folder = path.join(__dirname, 'fixtures', 'app1');

      request.post('http://localhost:10000/tasks/init', {
        form : {
          base_folder : base_folder,
          task_folder : 'tasks',
          instances   : 1,
          env         : {
            NODE_ENV : 'test'
          }
        }
      }, function(err, res, body) {
        setTimeout(done, 1000);
      });
    });

    it('should NS1 retrieve 5 tasks started', function(done) {
      request.get('http://localhost:10000/tasks/list', function(err, res, body) {
        should(err).be.null;
        should(res.statusCode).eql(200);
        var tasks = JSON.parse(body);
        should(tasks.length).eql(5);
        done();
      });
    });

    // PM2 is not dameonized by NS2
    it.skip('should NS2 retrieve 5 tasks started', function(done) {
      request.get('http://localhost:11000/tasks/list', function(err, res, body) {
        should(err).be.null;
        should(res.statusCode).eql(200);
        var tasks = JSON.parse(body);
        should(tasks.length).eql(5);
        done();
      });
    });

    it('should port of echo not incremented (stay 10001)', function() {
      n1.task_manager.getTasks().echo.port.should.eql(10001);
    });

    it('should n1 peers synchronized', function(done) {
      sync_file_size = fs.lstatSync('/tmp/n2.tar.gz').size;
      fs.lstatSync('/tmp/n2/');
      done();
    });

    it('should master see n2 has synchronized', function(done) {
      request.get('http://localhost:10000/hosts/list', function(e, r, b) {
        var dt = JSON.parse(b);
        dt[0].synchronized.should.be.true;
        done();
      });
    });


    it('should trigger task', function(done) {
      request.post('http://localhost:10000/tasks/lb_trigger_single', {
        form : {
          task_id : 'echo',
          data : {
            name : 'yey'
          }
        }
      }, function(err, raw, body) {
        var res = JSON.parse(body);
        res.data.hello.should.eql('yey');
        done();
      });
    });

    it('should trigger task with custom env', function(done) {
      request.post('http://localhost:10000/tasks/lb_trigger_single', {
        form : {
          task_id : 'env',
          data : {}
        }
      }, function(err, raw, body) {
        var res = JSON.parse(body);
        res.data.env.should.eql('test');
        done();
      });
    });

    it('should connect THIRD node', function(done) {
      this.timeout(10000);
      n3 = new network({
        peer_api_port  : 12000,
        tmp_file       : '/tmp/n3.tar.gz',
        tmp_folder     : '/tmp/n3'
      }, function() {
        // Wait some time that the new node synchronize
      });

      n3.on('synchronized', function(data) {
        console.log('Files synchronized');
        data.file.should.eql(n3.file_manager.getFilePath());
        setTimeout(done, 500);
      });
    });

    it('should now N1 retrieve three hosts connected', function(done) {
      request.get('http://localhost:10000/hosts/list', function(e, r, b) {
        var dt = JSON.parse(b);
        should(e).be.null;
        should(r.statusCode).eql(200);
        should(dt.length).eql(3);
        done();
      });
    });

    it('should now N2 retrieve two hosts connected', function(done) {
      request.get('http://localhost:11000/hosts/list', function(e, r, b) {
        var dt = JSON.parse(b);
        should(e).be.null;
        should(r.statusCode).eql(200);
        should(dt.length).eql(3);
        done();
      });
    });

    it('should now N3 retrieve two hosts connected', function(done) {
      request.get('http://localhost:12000/hosts/list', function(e, r, b) {
        var dt = JSON.parse(b);
        should(e).be.null;
        should(r.statusCode).eql(200);
        should(dt.length).eql(3);
        done();
      });
    });

    it('should N3 autosync because file already gen', function(done) {
      var stats = fs.lstatSync('/tmp/n3.tar.gz');
      stats.size.should.eql(sync_file_size);
      fs.lstatSync('/tmp/n3/');
      done();
    });
  });


  describe('Processing tasks checks', function() {
    it('should retrieve 0 processing tasks', function(done) {
      request.get('http://localhost:10000/tasks/processing', function(err, res, body) {
        should(err).be.null;
        should(res.statusCode).eql(200);
        var tasks = JSON.parse(body);
        should(tasks.length).eql(0);
        done();
      });
    });

    it('should trigger slow task and get it as being processed', function(done) {
      this.timeout(6000);

      setTimeout(function() {
        request.get('http://localhost:10000/tasks/processing', function(err, res, body) {
          should(err).be.null;
          should(res.statusCode).eql(200);
          var tasks = JSON.parse(body);
          should(tasks.length).eql(1);
          done();
        });
      }, 400);

      request.post('http://localhost:10000/tasks/lb_trigger_single', {
        form : {
          task_id : 'slow'
        }
      }, function(err, res, body) {
        should(res.statusCode).eql(200);
        //var res = JSON.parse(body);
        //done();
      });
    });
  });


  describe('End commands', function() {
    it('should clear all tasks', function(done) {
      request.delete('http://localhost:10000/tasks/clear', function(err, raw, body) {
        done();
      });
    });

    it('should clear (file + api)', function(done) {
      n1.close(function() {
        n3.close(function() {
          n2.close(done);
        });
      });
    });
  });

});