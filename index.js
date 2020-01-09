const os       = require('os');
const path     = require('path');
const sh       = require('shelljs')
const express  = require('express');
const siofu    = require('socketio-file-upload');
const app      = express();
const server   = require('http').Server(app);
const io       = require('socket.io')(server);

const getFiles = require('./utils/getfiles');
const jsonfile = require('jsonfile');

const public = path.join(__dirname, 'public');
const port = 8080;

const paths = {
  queue: path.join(public, '.queue'),
  cache: path.join(public, '.cache'),
  history: path.join(public, '.history'),
  trash: path.join(public, '.deleted')
};
const queue = require('./utils/queue')(paths);
//console.log(queue.jobs, queue.currentJob)
//queue.run()
// -------------------------------------------------------------------------
app.use(siofu.router);
app.use(express.static(public));
server.listen(port, () => {
  let interfaces = os.networkInterfaces();
  let addresses = [];
  for (let k in interfaces) {
    for (let k2 in interfaces[k]) {
      let address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }

  console.log(`Server up and running on http://${addresses[0]}:${port}`);
});

// -------------------------------------------------------------------------
let progressTimer,
    progressTotal = 0;

io.on('connection', (socket) => {
  console.log('connection: ',socket.id)
  
  socket.emit('handshake', {queue: queue.jobs, history: queue.history});

  let uploader = new siofu();
  uploader.dir = paths.trash;
  uploader.listen(socket);

  uploader.on('saved', (event) => {
    try {
      let content = jsonfile.readFileSync(event.file.pathName);
      queue.push(content.name, content.buffer);
    } catch (e) {
      console.log('ERROR: ',e);
      socket.emit('err', e);
    }
  });

  uploader.on('error', (err) => socket.emit('err', err.toString()));
  queue.run()
  queue.serial.on('error', (err) => socket.emit('err', err.toString()));

  queue.serial.on('job-start', (data) => {
    progressTimer = Date.now();
    socket.emit('job-progress', {
      job: queue.currentJob,
      progress: {
        value: 0,
        total: data.job.buffer.length,
      },
      time: {
        start: progressTimer,
        now: progressTimer,
      }
    });
  });

  queue.serial.on('job-progress', (data) => {
    socket.emit('job-progress', {
      job: queue.currentJob,
      progress: {
        value: data.progress.elapsed,
        total: data.progress.total,
        cmd: data.cmd,
      },
      time: {
        start: progressTimer,
        now: Date.now(),
      }
    });
  });

  queue.on('job-queue', (job) => socket.emit('job-queue', job));
  queue.on('job-archive', (job) => socket.emit('job-archive', job));
  queue.on('job-delete', (job) => socket.emit('job-delete', job));

  listen('job', (data) => {
    console.log(`${data.name} received.`);
    if (data.buffer) {
      console.log(`${data.name} valid.`);
      queue.push(data.name, data.buffer);
    }
  });

  listen('redraw', (jobID) => {console.log('redraw from client');queue.redraw(jobID)});
  listen('delete', (jobID) => {console.log('delete from client');queue.trash(jobID)});
  listen('resume', () => {console.log('resume from client'); queue.serial.resume()});
  listen('pause', () => {console.log('pause from client');queue.serial.pause()});
  listen('run', () => {console.log('run from client'); queue.run()});
  listen('cancel', () => {console.log('cancel from client');queue.serial.disconnect()});

  listen('shutdown', () => {console.log('shutdown from client'); sh.exec('sudo /sbin/shutdown now')})

  function listen(event, cb, validate = null) {
    validate = validate || function() { return true; };
    socket.on(event, function(data, fn = null) {
      cb(data);
      if (fn) fn(validate(data));
    });
  }

});
