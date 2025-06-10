
function decompress(baseStats, newStats) {
    const timestamp = newStats.timestamp
    delete newStats.timestamp;
    Object.keys(newStats).forEach(id => {
      if (!baseStats[id]) {
        if (newStats[id].timestamp === 0) {
          newStats[id].timestamp = timestamp;
        }
        baseStats[id] = newStats[id];
      } else {
        const report = newStats[id];
        if (report.timestamp === 0) {
            report.timestamp = timestamp;
        } else if (!report.timestamp) {
            report.timestamp = new Date(baseStats[id].timestamp).getTime();
        }
        Object.keys(report).forEach(name => {
          baseStats[id][name] = report[name];
        });
      }
    });
    return baseStats;
  }
  
  let fileFormat;
  let thelog;  // Declare thelog at the beginning
   function doImport(evt) {
     
    evt.target.disabled = 'disabled';
    const files = evt.target.files;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (function(file) {
      return function(e) {
        let result = e.target.result;
        if (typeof result === 'object') {
          result = pako.inflate(result, {to: 'string'});
        }
        if (result.indexOf('\n') === -1) {
          // old format v0
          thelog = JSON.parse(result);
        } else {
          // new format, multiple lines
          const baseStats = {};
          const lines = result.split('\n');
          const client = JSON.parse(lines.shift());
          fileFormat = client.fileFormat;
          client.peerConnections = {};
          client.getUserMedia = [];
          lines.forEach(line => {
              if (line.length) {
                  const data = JSON.parse(line);
                  const time = new Date(data.time || data[data.length - 2]);
                  delete data.time;
                  switch(data[0]) {
                  case 'getUserMedia':
                  case 'getUserMediaOnSuccess':
                  case 'getUserMediaOnFailure':
                  case 'navigator.mediaDevices.getUserMedia':
                  case 'navigator.mediaDevices.getUserMediaOnSuccess':
                  case 'navigator.mediaDevices.getUserMediaOnFailure':
                  case 'navigator.mediaDevices.getDisplayMedia':
                  case 'navigator.mediaDevices.getDisplayMediaOnSuccess':
                  case 'navigator.mediaDevices.getDisplayMediaOnFailure':
                      client.getUserMedia.push({
                          time: time,
                          type: data[0],
                          value: data[2]
                      });
                      break;
                  default:
                      if (!client.peerConnections[data[1]]) {
                          client.peerConnections[data[1]] = [];
                          baseStats[data[1]] = {};
                      }
                      if (data[0] === 'getstats') { // delta-compressed
                          data[2] = decompress(baseStats[data[1]], data[2]);
                          baseStats[data[1]] = JSON.parse(JSON.stringify(data[2]));
                      }
                      if (data[0] === 'getStats' || data[0] === 'getstats') {
                          data[2] = mangle(data[2]);
                          data[0] = 'getStats';
                      }
                      client.peerConnections[data[1]].push({
                          time: time,
                          type: data[0],
                          value: data[2]
                      });
                      break;
                  }
              }
          });
          thelog = client;
        }
        importUpdatesAndStats(thelog);
      };
    })(file);
    if (file.type === 'application/gzip') {
      reader.readAsArrayBuffer(files[0]);
    } else {
      reader.readAsText(files[0]);
    }
  }
  
  function createContainers(connid, url) {
      let el;
      const container = document.createElement('details');
      container.open = true;
      container.style.margin = '10px';
  
      let summary = document.createElement('summary');
      summary.innerText = 'Connection:' + connid + ' URL: ' + url;
      container.appendChild(summary);
  
      let signalingState;
      let iceConnectionState;
      let connectionState;
      if (connid !== 'null') {
          // show state transitions, like in https://webrtc.github.io/samples/src/content/peerconnection/states
          signalingState = document.createElement('div');
          signalingState.id = 'signalingstate_' + connid;
          signalingState.textContent = 'Signaling state:';
          container.appendChild(signalingState);
  
          iceConnectionState = document.createElement('div');
          iceConnectionState.id = 'iceconnectionstate_' + connid;
          iceConnectionState.textContent = 'ICE connection state:';
          container.appendChild(iceConnectionState);
  
          connectionState = document.createElement('div');
          connectionState.id = 'connectionstate_' + connid;
          connectionState.textContent = 'Connection state:';
          container.appendChild(connectionState);
      }
  
      let candidates;
      if (connid !== 'null') {
          // for ice candidates
          const iceContainer = document.createElement('details');
          iceContainer.open = true;
          summary = document.createElement('summary');
          summary.innerText = 'ICE candidate grid';
          iceContainer.appendChild(summary);
  
          candidates = document.createElement('table');
          candidates.className = 'candidatepairtable';
          const head = document.createElement('tr');
          candidates.appendChild(head);
  
          el = document.createElement('td');
          el.innerText = 'Local address';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Local type';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Remote address';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Remote type';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Requests sent';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Responses received';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Requests received';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Responses sent';
          head.appendChild(el);
  
          el = document.createElement('td');
          el.innerText = 'Active Connection';
          head.appendChild(el);
  
          iceContainer.appendChild(candidates);
          container.appendChild(iceContainer);
      }
  
      const updateLogContainer = document.createElement('details');
      updateLogContainer.open = true;
      container.appendChild(updateLogContainer);
  
      summary = document.createElement('summary');
      summary.innerText = 'PeerConnection updates:';
      updateLogContainer.appendChild(summary);
  
      const updateLog = document.createElement('table');
      updateLogContainer.appendChild(updateLog);
  
  
      const graphs = document.createElement('div');
  
      container.appendChild(graphs);
  
      containers[connid] = {
          updateLog,
          iceConnectionState,
          connectionState,
          signalingState,
          candidates,
          graphs,
      };
  
      return container;
  }
  
  function processGUM(data) {
      const container = document.createElement('details');
      container.open = true;
      container.style.margin = '10px';
  
      const summary = document.createElement('summary');
      summary.innerText = 'getUserMedia calls';
      container.appendChild(summary);
  
      const table = document.createElement('table');
      const head = document.createElement('tr');
      table.appendChild(head);
  
      let el;
      el = document.createElement('th');
      el.innerText = 'getUserMedia';
      head.appendChild(el);
  
      container.appendChild(table);
  
      document.getElementById('tables').appendChild(container);
      data.forEach(event => {
          processTraceEvent(table, event); // abusing the peerconnection trace event processor...
      });
  }
  
  function processTraceEvent(table, event) {


      const row = document.createElement('tr');
      let el = document.createElement('td');
      el.setAttribute('nowrap', '');

      
      const date = new Date(event.time);
      const formattedTime = date.toLocaleTimeString('tr-TR') + `:${date.getMilliseconds().toString().padStart(3, '0')}`;
      const updatedTime = date.toString().replace(/\d{2}:\d{2}:\d{2}/, formattedTime);
  
      el.innerText = updatedTime;
      row.appendChild(el);
  
      // recreate the HTML of webrtc-internals
      const details = document.createElement('details');
      el = document.createElement('summary');
      el.innerText = event.type;
      details.appendChild(el);
  
      el = document.createElement('pre');
      if (['createOfferOnSuccess', 'createAnswerOnSuccess', 'setRemoteDescription', 'setLocalDescription'].indexOf(event.type) !== -1) {
          el.innerText = 'SDP ' + event.value.type + ':' + event.value.sdp;
      } else {
          el.innerText = JSON.stringify(event.value, null, ' ');
      }
      details.appendChild(el);
  
      el = document.createElement('td');
      el.appendChild(details);
  
      row.appendChild(el);
  
      // guess what, if the event type contains 'Failure' one could use css to highlight it
      if (event.type.indexOf('Failure') !== -1) {
          row.style.backgroundColor = 'red';
      }
      if (event.type === 'iceConnectionStateChange') {
          switch(event.value) {
          case 'ICEConnectionStateConnected':
          case 'ICEConnectionStateCompleted':
              row.style.backgroundColor = 'green';
              break;
          case 'ICEConnectionStateFailed':
              row.style.backgroundColor = 'red';
              break;
          }
      }
  
      if (event.type === 'onIceCandidate' || event.type === 'addIceCandidate') {
          if (event.value && event.value.candidate) {
              const parts = event.value.candidate.trim().split(' ');
              if (parts && parts.length >= 9 && parts[7] === 'typ') {
                  details.classList.add(parts[8]);
              }
          }
      }
      table.appendChild(row);
  }
  
  const graphs = {};
  const containers = {};
  function processConnections(connectionIds, data) {
      const connid = connectionIds.shift();
      if (!connid) return;
      window.setTimeout(processConnections, 0, connectionIds, data);
  
      let reportname, statname;
      const connection = data.peerConnections[connid];
      const container = createContainers(connid, data.url);
      document.getElementById('tables').appendChild(container);
  
      for (let i = 0; i < connection.length; i++) {
          if (connection[i].type !== 'getStats' && connection[i].type !== 'getstats') {
              processTraceEvent(containers[connid].updateLog, connection[i]);
          }
      }
  
      // then, update the stats displays
      const series = {};
      let connectedOrCompleted = false;
      let firstStats;
      let lastStats;
  
      const candidatePairData = [];

    // Burada mediaType'ı almak için `stats` objesinden erişim sağlıyoruz
    const mediaTypes = {};
      
      for (let i = 0; i < connection.length; i++) {
          if (connection[i].type === 'oniceconnectionstatechange' && (connection[i].value === 'connected' || connection[i].value === 'completed')) {
              connectedOrCompleted = true;
          }
          if (connection[i].type === 'getStats' || connection[i].type === 'getstats') {
              const stats = connection[i].value;
              Object.keys(stats).forEach(id => {
                
                  if (stats[id].type === 'localcandidate' || stats[id].type === 'remotecandidate') return;
                  if (!(
                    (stats[id].type === "inbound-rtp" && stats[id].kind === "audio") ||
                    (stats[id].type === "outbound-rtp" && stats[id].kind === "audio") || 
                    (stats[id].type === "inbound-rtp" && stats[id].kind === "video") ||
                    (stats[id].type === "outbound-rtp" && stats[id].kind === "video") ||
                     // candidate-pair tipi ve bytes değerleri sıfır olmayanlar
                    (stats[id].type === 'candidate-pair' && stats[id].state === 'succeeded' &&
                    (stats[id].bytesSent > 0 || (stats[id].bytesReceived > 0 && stats[id].bytesSent > 0) ))
                )) {
                    return; 
                }
                  if (stats[id].type === 'candidate-pair' && stats[id].state === 'succeeded') {
                      // Son veri olarak candidatePairData'ya ekliyoruz, önceki veriler silinir
                      candidatePairData.length = 0; // önceki veriyi sil
                      candidatePairData.push({
                          id,
                          ...stats[id], // Son candidate-pair objesinin tüm bilgilerini alıyoruz
                      });
                  }

                    // id'ye karşılık gelen mediaType'ı alıp kaydediyoruz
                    const mediaType = stats[id].kind || null;
                    if (mediaType) {
                        mediaTypes[id] = mediaType; // id'yi ve mediaType'ı kaydediyoruz
                    }
  
                  Object.keys(stats[id]).forEach(name => {
                      if (name === 'timestamp') return;
                      //if (name === 'googMinPlayoutDelayMs') stats[id][name] = parseInt(stats[id][name], 10);
                      if (stats[id].type === 'ssrc' && !isNaN(parseFloat(stats[id][name]))) {
                          stats[id][name] = parseFloat(stats[id][name]);
                      }
                      if (stats[id].type === 'ssrc' && name === 'ssrc') return; // ignore ssrc on ssrc reports.
                      if (typeof stats[id][name] === 'number') {
                          if (!series[id]) {
                              series[id] = {};
                              series[id].type = stats[id].type;
                          }
                          if (!series[id][name]) {
                              series[id][name] = [];
                          } else {
                              const lastTime = series[id][name][series[id][name].length - 1][0];
                              if (lastTime && stats[id].timestamp && stats[id].timestamp - lastTime > 20000) {
                                  series[id][name].push([stats[id].timestamp || new Date(connection[i].time).getTime(), null]);
                              }
                          }
                          if (fileFormat >= 2) {
                              series[id][name].push([stats[id].timestamp, stats[id][name]]);
                          } else {
                              series[id][name].push([new Date(connection[i].time).getTime(), stats[id][name]]);
                          }
                      }
                  });
              });
          }
          if (connection[i].type === 'getStats' || connection[i].type === 'getstats') {
              if (!firstStats && connectedOrCompleted) firstStats = connection[i].value;
              lastStats = connection[i].value;
          }
      }
      const interestingStats = lastStats; // might be last stats which contain more counters
      if (interestingStats) {
          const stun = [];
          let t;
          for (reportname in interestingStats) {
              if (reportname.indexOf('Conn-') === 0) {
                  t = reportname.split('-');
                  comp = t.pop();
                  t = t.join('-');
                  stats = interestingStats[reportname];
                  stun.push(stats);
              }
          }
          for (t in stun) {
              const row = document.createElement('tr');
              let el;
  
              el = document.createElement('td');
              el.innerText = stun[t].googLocalAddress;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].googLocalCandidateType;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].googRemoteAddress;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].googRemoteCandidateType;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].requestsSent;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].responsesReceived;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].requestsReceived;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].responsesSent;
              row.appendChild(el);
  
              el = document.createElement('td');
              el.innerText = stun[t].googActiveConnection;
              row.appendChild(el);
              /*
              el = document.createElement('td');
              el.innerText = stun[t].consentRequestsSent;
              row.appendChild(el);
              */
  
              containers[connid].candidates.appendChild(row);
          }
      }
  
      const graphTypes = {};
      const graphSelectorContainer = document.createElement('div');
      containers[connid].graphs.appendChild(graphSelectorContainer);
  
      // graphsContainer wrapper flexbox
      const graphsContainer = document.createElement('div');
      graphsContainer.style.display = 'flex';
      graphsContainer.style.flexWrap = 'wrap';  
      graphsContainer.style.gap = '10px'; 
      containers[connid].graphs.appendChild(graphsContainer);
  
       // ** candidatePairData'yi burada yazdırıyoruz
       const candidatePairDetailsContainer = document.createElement('details');
       candidatePairDetailsContainer.style.marginTop = '20px';
   
       if (candidatePairData.length > 0) {
           const firstPair = candidatePairData[0]; // İlk veriyi alıyoruz
           const summary = document.createElement('summary');
           summary.innerHTML = `candidate-pair (state=${firstPair.state}, id=${firstPair.id})`; // Özelleştirilmiş başlık
           summary.style.fontWeight = 'bold'; // Başlığı bold yapmak için stil ekliyoruz
           candidatePairDetailsContainer.appendChild(summary);
       }
       
       candidatePairData.forEach(pair => {
        const detailsDiv = document.createElement('div');
        detailsDiv.style.marginBottom = '15px';
    
        Object.keys(pair).forEach(key => {
            if (key !== 'state' && key !== 'id') { // state ve id'yi tekrar listelememek için
                const detail = document.createElement('div');
    
                let value = pair[key];
    
                // Sadece belirli alanları tarih formatına çevir
                if (['timestamp', 'lastPacketReceivedTimestamp', 'lastPacketSentTimestamp'].includes(key)) {
                    value = new Date(value).toLocaleString();
                   
                }
    
                detail.innerHTML = `<strong>${key}</strong>: ${value}`;
                detailsDiv.appendChild(detail);
            }
        });
    
        candidatePairDetailsContainer.appendChild(detailsDiv);
    });
    
       containers[connid].graphs.appendChild(candidatePairDetailsContainer);
      
      graphs[connid] = {};
      const reportobj = {};

      // çizilecek grafikler
      const whiteList = [
        "bytesReceived",
        "bytesSent",
        "frameWidth",
        "frameHeight",
        "framesPerSecond",
        "packetsLost",
        "currentRoundTripTime",
      ];

    // saniye bazlı çizilecek 5 dakikalık zoomlu grafikler
      const listForSecond = ["bytesReceived", "bytesSent"];
      let chartIdCounter = 0;

    // Tüm series objesini alıyoruz, 'bytesReceived', 'bytesSent', vb. istenen metrikleri sıralıyoruz.
const sortedSeries = [];

for (const reportname in series) {
    const graphType = series[reportname].type;

    Object.keys(series[reportname]).filter(name => 
        (whiteList.includes(name)) &&
        !((name === "bytesReceived" && series[reportname].type !== "inbound-rtp") || 
        (name === "bytesSent" && series[reportname].type !== "outbound-rtp"))
    ).forEach(name => {
        if (name === 'type') return;

        // Her reportname ve name çiftini sortedSeries array'ine ekliyoruz
        sortedSeries.push({
            connid: reportname,  // 'connid' yerine 'reportname' kullanılıyor
            name: name,
            data: series[reportname][name],
            graphType: graphType,
            style: series[reportname][name].style // Stilleri buraya ekliyoruz
        });
    });
}

        // sortedSeries şimdi tüm veriyi doğru sırayla içeriyor
        sortedSeries.sort((a, b) => {
            // Bu kısmı istediğiniz sıraya göre özelleştirebilirsiniz
            // Öncelikli olarak 'name' değeri üzerinden sıralayabilirsiniz
            return a.name.localeCompare(b.name);
        });

                // Şimdi 'currentRoundTripTime'ı en sona taşıyoruz
        const currentRoundTripItem = sortedSeries.find(item => item.name === 'currentRoundTripTime');
        if (currentRoundTripItem) {
            // 'currentRoundTripTime'ı sıralanmış diziden çıkarıyoruz
            sortedSeries.splice(sortedSeries.indexOf(currentRoundTripItem), 1);
            // 'currentRoundTripTime'ı dizinin sonuna ekliyoruz
            sortedSeries.push(currentRoundTripItem);
        }


        // Şimdi sıralı veriyi işliyoruz ve grafiklerimizi oluşturuyoruz
        sortedSeries.forEach(item => {
            const { connid, name, data, graphType, style } = item;

            // Burada grafik oluşturma ve başlıkları ekleme işlemini yapıyoruz
            const container = document.createElement('div');
            
         // MinWidth hesaplaması ekliyoruz
        const dataLength = data.length;
        const minWidth = (dataLength > 50 ? `${(dataLength / 3)}%` : '40%');

        // Stil ekleme
        container.style.minWidth = minWidth;
        container.classList.add('webrtc-' + graphType);

        // Eğer daha önce stil varsa, onları da koruyarak yeni stil ekliyoruz
        if (style) {
            Object.assign(container.style, style); // Mevcut stil ile yeni stili birleştiriyoruz
        }

        graphsContainer.appendChild(container);

            let title = `${connid} type=${graphType} ${name}`;
            if (listForSecond.includes(name)) {
                title += '/s';
            }

            // bytesSent / bytesReceived için mediaType ekliyoruz
            if (name === "bytesSent" || name === "bytesReceived") {
                const mediaTypeForId = mediaTypes[connid] || ''; // id'ye karşılık gelen mediaType'ı alıyoruz
                title += mediaTypeForId ? ` (${mediaTypeForId})` : '';
            }

            const chartContainer = document.createElement('div');
            chartContainer.id = `chart_${chartIdCounter++}`;
            container.appendChild(chartContainer);

            // Veriyi işliyoruz
            const processedData = [];
            const turkishTimeOffset = 3 * 60 * 60 * 1000; // 3 saat milisaniye cinsinden

            data.forEach((itemData, i) => {
                let [timestamp, value] = itemData; // orjinal
                timestamp += turkishTimeOffset;  // Türkiye saatine çeviriyoruz


                if (i === 0) {
                    processedData.push([timestamp, 0]);
                    return;
                }

                const [prevTimestamp, prevValue] = data[i - 1];
                const timeDiff = (timestamp - prevTimestamp) / 1000;

                const valuePerSecond = listForSecond.includes(name)
                    ? (value - prevValue) / timeDiff
                    : value;

                const formattedValue = (name === "currentRoundTripTime")
                    ? Math.round(value * 1000) // 0.062 -> 62
                    : Math.round(valuePerSecond * 100) / 100; // Diğerleri için 2 ondalık basamak

                if (formattedValue >= 0) {
                    processedData.push([timestamp, formattedValue]);
                }
            });

            const lastTimestamp = processedData[processedData.length - 1][0];
            const fiveMinutesAgo = lastTimestamp - (5 * 60 * 1000);

            const graph = new Highcharts.Chart({
                title: {
                    text: title
                },
                xAxis: {
                    type: 'datetime',
                    labels: {
                        rotation: -45,
                        // formatter: function() {
                        //     // Zaman damgasını saat:dakika:saniye:milisaniye formatında göster
                        //     const date = new Date(this.value); // x eksenindeki her bir zaman damgasını alıyoruz
                        //     console.log(date,'date')
                        //     const hours = date.getHours().toString().padStart(2, '0');
                        //     const minutes = date.getMinutes().toString().padStart(2, '0');
                        //     const seconds = date.getSeconds().toString().padStart(2, '0');
                        //     const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
                            
                        //     return `${hours}:${minutes}:${seconds}:${milliseconds}`; // Yeni format
                        // }
                    },
                },
                yAxis: {
                    min: 0,
                    title: {
                        text: null
                    }
                },
                chart: {
                    zoomType: 'x',
                    renderTo: chartContainer.id,
                    panning: true,
                    panKey: 'shift'
                },
                series: [{
                    type: 'line',
                    data: processedData,
                    showInLegend: false
                }]
            });

            // Son 5 dakikayı zoomla, sadece 'listForSecond' içindeyse
            if (listForSecond.includes(name)) {
                processedData.length > 50 && graph.xAxis[0].setExtremes(fiveMinutesAgo, lastTimestamp);
            }

            // Grafiği kaydediyoruz
           //  graphs[connid][`${reportname}-${name}`] = graph;
        });

  }

  
  function importUpdatesAndStats(data) {
      document.getElementById('userAgent').innerText = data.userAgent;
      processGUM(data.getUserMedia);
      window.setTimeout(processConnections, 0, Object.keys(data.peerConnections), data);
  }
  