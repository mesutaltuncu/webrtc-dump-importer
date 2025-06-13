
document.addEventListener('DOMContentLoaded', function () {
    const dropZone = document.getElementById('dropZone');
    const loadingMessage = document.getElementById('loadingMessage');
    const controlsContainer = document.getElementById('controlsContainer');
    const toggleButton = document.getElementById('toggleButton');

    dropZone.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.log';
        fileInput.onchange = (e) => handleFile(e.target.files[0]);
        fileInput.click();
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#e2e6ea';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.backgroundColor = '#f8f9fa';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#f8f9fa';
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    function handleFile(file) {
        if (!file) return;
        
        loadingMessage.style.display = 'block';
        const reader = new FileReader();
        
        reader.onload = function (e) {
            const logContent = e.target.result;
            parseLogFile(logContent);

            loadingMessage.style.display = 'none';
            
            // Eğer `details` elemanları varsa Expand/Collapse butonunu göster
            const detailsElements = document.querySelectorAll('details');
            if (detailsElements.length > 0) {
                controlsContainer.style.display = 'block';
            }
        };

        reader.readAsText(file);
    }

    // ✅ Expand/Collapse Mekanizması
    toggleButton.addEventListener('click', function () {
        const detailsElements = document.querySelectorAll('details');
        const isExpanded = this.textContent === 'Expand All';

        detailsElements.forEach(detail => {
            detail.open = isExpanded;
        });

        this.textContent = isExpanded ? 'Collapse All' : 'Expand All';
    });
});



let calls = [];

function parseLogFile(logContent) {
    const logLines = logContent.split('\n');
    calls = [];

    let state = {
        calls: [],
        currentCall: null,
        collecting: false,
        foundMyNumber: false,
        myNumber: null,
        logLines,
        i: 0,
    };

    for (state.i = 0; state.i < logLines.length; state.i++) {
        const line = logLines[state.i];
        window.parseIosLine(line, state);
    }

    calls = state.calls;


    if (calls.length > 0) {
        console.log('✅ All Calls Data with bipRoomName:', calls);
        createTabs();
        visualizeCallData(0);
    } else {
        console.log('⚠️ No calls found.');
    }
}

function createTabs() {
    const tabContainer = document.getElementById('tabContainer');
    tabContainer.innerHTML = '';

    calls.forEach((call, index) => {
        let tabLabel = call.bipRoomName ? call.bipRoomName : `Call ${index + 1}`;

        const tabButton = document.createElement('button');
        tabButton.textContent = "Bip Room Name: " + tabLabel;
        tabButton.style.margin = '5px';
        tabButton.style.padding = '8px 12px';
        tabButton.style.cursor = 'pointer';
        tabButton.style.border = '1px solid #ccc';
        tabButton.style.backgroundColor = '#f3f3f3';

        tabButton.onclick = () => {
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.style.backgroundColor = '#f3f3f3';
                btn.style.fontWeight = 'normal';
            });

            tabButton.style.backgroundColor = '#d1e7fd';
            tabButton.style.fontWeight = 'bold';

            visualizeCallData(index);
        };

        tabButton.classList.add('tab-button');
        tabContainer.appendChild(tabButton);
    });

    if (calls.length > 0) {
        document.querySelector('.tab-button').click();
    }
}



function visualizeCallData(callIndex) {
    const call = calls[callIndex];

    if (!call || !call.connectionStats.length) {
        console.log('⚠️ No data available for visualization.');
        return;
    }

    const container = document.getElementById('logOutput');
    container.innerHTML = ''; 
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';

    const firstTimestamp = call.connectionStats[0]?.timestamp || 'Unknown Timestamp';

    let callerNumber = "Unknown";
    if (call.bipRoomName) {
        const match = call.bipRoomName.match(/^(\d+)_/);
        if (match && match[1]) {
            callerNumber = match[1];
        }
    }


    let participantNumbers = "No Participants";
    if (call.participants && call.participants.length > 0) {
        participantNumbers = call.participants.join(", ");
    }

    const resolveTrackLabel = (() => {
        const resolved = new Map();
        let assignedFallbackRemote = false;
    
        return (trackId) => {
            if (resolved.has(trackId)) return resolved.get(trackId);
    
            if (trackId === call.localSsrc) {
                resolved.set(trackId, "local");
                return "local";
            }
    
            if (trackId === call.remoteSsrc) {
                resolved.set(trackId, "remote");
                return "remote";
            }
    
            if (call.ssrcs?.includes(trackId)) {
                resolved.set(trackId, "local");
                return "local";
            }
    
            if (!assignedFallbackRemote) {
                resolved.set(trackId, "remote");
                assignedFallbackRemote = true;
                return "remote";
            }
    
            resolved.set(trackId, trackId);
            return trackId;
        };
    })();
    

    // ✅ Bilgi Kartı (Call Info Card)
    const infoCard = document.createElement('div');
    infoCard.style.width = '500px';  // Daha dar genişlik
    infoCard.style.padding = '8px 12px';
    infoCard.style.margin = '15px auto';  // Ortalamak için "auto"
    infoCard.style.borderRadius = '8px';
    infoCard.style.boxShadow = '0px 2px 6px rgba(0, 0, 0, 0.1)';
    infoCard.style.backgroundColor = '#fff';
    infoCard.style.textAlign = 'left';
    infoCard.style.fontFamily = 'Arial, sans-serif';
    infoCard.style.border = '1px solid #ddd';

    // ✅ İçerik Satırlarını Oluşturma Fonksiyonu
    const createInfoRow = (label, value) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '5px';  // Sağ ve sol yazılar arasındaki boşluğu azalt
        row.style.fontSize = '13px';  
        row.style.borderBottom = '1px solid #eee';
        row.style.padding = '5px 0';

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        labelEl.style.fontWeight = 'bold';
        labelEl.style.color = '#222';
        labelEl.style.flexShrink = '0'; // Label daralmadan sabit kalsın

        const valueEl = document.createElement('span');
        valueEl.textContent = value;
        valueEl.style.color = '#555';
        valueEl.style.flexGrow = '1'; // Değer kısmı genişlesin
        valueEl.style.overflow = 'hidden';
        valueEl.style.textOverflow = 'ellipsis';
        valueEl.style.whiteSpace = 'nowrap';

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        return row;
    };

    // ✅ Bilgileri Kart İçerisine Ekleyelim
    infoCard.appendChild(createInfoRow("Call Date:", firstTimestamp));
    infoCard.appendChild(createInfoRow("End Call Date:", call.endCallDate || "Unknown"));
    infoCard.appendChild(createInfoRow("Caller Number:", callerNumber));
    infoCard.appendChild(createInfoRow("Bip Room Name:", call.bipRoomName || "Unknown"));
    infoCard.appendChild(createInfoRow("Participants:", participantNumbers));
    infoCard.appendChild(createInfoRow("Remote Candidate Type:", call.remoteCandidateType || "N/A"));
    infoCard.appendChild(createInfoRow("Local Candidate Type:", call.localCandidateType || "N/A"));

    // ✅ Süre Hesaplama (Duration)
    let durationText = "Unknown";
    if (call.endCallDate && firstTimestamp !== "Unknown Timestamp") {
        const start = new Date(firstTimestamp);
        const end = new Date(call.endCallDate);
        const durationMs = end - start;

        if (!isNaN(durationMs)) {
            const minutes = Math.floor(durationMs / 60000);
            const seconds = Math.floor((durationMs % 60000) / 1000);
            durationText = `${minutes}m ${seconds}s`;
        }
    }
    infoCard.appendChild(createInfoRow("Duration:", durationText));

    container.appendChild(infoCard);

    if (call.codecInfo) {
        const codecDetails = document.createElement("details");
        codecDetails.style.width = '100%';
        codecDetails.style.marginBottom = '10px';
    
        const summary = document.createElement("summary");
        summary.textContent = "🎙️ Codec Info (Raw JSON)";
        summary.style.cursor = "pointer";
        summary.style.fontWeight = "bold";
        codecDetails.appendChild(summary);
    
        const pre = document.createElement("pre");
        pre.className = "language-json";
        pre.style.whiteSpace = "pre-wrap";
        pre.style.wordBreak = "break-word";
        pre.style.overflowX = "auto";
        pre.style.paddingLeft = "10px";
        pre.style.fontSize = "12px";
    
        const code = document.createElement("code");
        code.className = "language-json";
        code.textContent = JSON.stringify(call.codecInfo, null, 2);
    
        pre.appendChild(code);
        codecDetails.appendChild(pre);
        container.appendChild(codecDetails);
    
        if (window.Prism && Prism.highlightElement) {
            requestAnimationFrame(() => Prism.highlightElement(code));
        }
    }
    
     

      // ✅ Media Constraints
if (call.mediaConstraints && call.mediaConstraints.length > 0) {
    const detailsContainer = document.createElement('details');
    detailsContainer.style.width = '100%';
    detailsContainer.style.marginBottom = '10px';

    const summary = document.createElement('summary');
    summary.textContent = "Media Constraints";
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = 'bold';
    detailsContainer.appendChild(summary);

    call.mediaConstraints.forEach((constraint) => {
        const preElement = document.createElement('pre');
        preElement.className = 'language-log';
        preElement.style.whiteSpace = 'pre-wrap';
        preElement.style.wordBreak = 'break-word';
        preElement.style.overflowX = 'auto';
        preElement.style.maxWidth = '100%';
        preElement.style.fontSize = '12px';
        preElement.style.marginTop = '5px';

        const codeElement = document.createElement('code');
        preElement.className = 'language-log';;

        codeElement.textContent = `[${constraint.timestamp}]\n${JSON.stringify(constraint, null, 2)}`;

        preElement.appendChild(codeElement);
        detailsContainer.appendChild(preElement);

        if (window.Prism) {
            Prism.highlightElement(codeElement);
        }
    });

    container.appendChild(detailsContainer);
}

    // ✅ PeerConnection Updates Açılır/Kapanır Yapı
    const peerConnectionDetails = document.createElement('details');
    peerConnectionDetails.style.width = '100%';
    peerConnectionDetails.style.marginBottom = '10px';

    const peerSummary = document.createElement('summary');
    peerSummary.textContent = "PeerConnection Updates";
    peerSummary.style.cursor = 'pointer';
    peerSummary.style.fontWeight = 'bold';
    peerConnectionDetails.appendChild(peerSummary);

    const peerLogContainer = document.createElement('div');
    peerLogContainer.style.fontFamily = 'monospace';
    peerLogContainer.style.whiteSpace = 'pre-wrap';

    // ✅ PeerConnection ile ilgili tüm olayları tarih sırasına göre sıralayalım
    let allEvents = [];

    function addEvent(eventArray, type) {
        if (eventArray && eventArray.length > 0) {
            eventArray.forEach(event => {
                allEvents.push({ timestamp: event.timestamp, type, data: event });
            });
        }
    }

    addEvent(call.create, "create");
    addEvent(call.createOffers, "createOffer");
    addEvent(call.createAnswers, "createAnswer");
    addEvent(call.onNegotiationNeeded, "onnegotiationneeded");
    addEvent(call.signalingStates, "onsignalingstatechange");
    addEvent(call.onIceCandidates, "onicecandidate");
    addEvent(call.onIceConnectionStateChanges, "oniceconnectionstatechange");
    addEvent(call.createOfferOnSuccess, "createOfferOnSuccess");
    addEvent(call.addIceCandidates, "addIceCandidates");
    addEvent(call.setLocalDescriptionOnSuccess, "setLocalDescriptionOnSuccess");
    addEvent(call.setRemoteDescriptionOnSuccess, "setRemoteDescriptionOnSuccess");
    addEvent(call.createAnswerOnSuccess, "createAnswerOnSuccess");
    addEvent(call.iceGatheringStates, "iceGatheringStatesChanged");
    addEvent(call.webrtcModuleErrors, "webrtcModuleErrors");
    
    
    // ✅ Olayları timestamp'e göre sırala
    allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
// ✅ Açılır kapanır yapıya ekleyelim
    allEvents.forEach(event => {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        if (event.type === 'webrtcModuleErrors') {
            summary.innerHTML = `${event.timestamp} <span style="color: red;">${event.type}</span>`;
        } else {
            summary.textContent = `${event.timestamp} ${event.type}`;
        }
        summary.style.cursor = 'pointer';
        details.appendChild(summary);

        // ✅ Prism.js kullanarak renklendirilmiş log bloğu oluştur
        const preElement = document.createElement('pre');
        preElement.className = 'language-log'; // Prism log formatı
        preElement.style.whiteSpace = 'pre-wrap';
        preElement.style.wordBreak = 'break-word';
        preElement.style.overflowX = 'auto';
        preElement.style.maxWidth = '100%';

        const codeElement = document.createElement('code');
        codeElement.className = 'language-log';

        // ✅ Eğer SDP varsa ve çok satırlıysa onu ayrı satırlarda göster
        if (event.data && typeof event.data.sdp === 'string' && (event.data.sdp.includes('\\r\\n') || event.data.sdp.includes('\n'))) {
            const sdpText = event.data.sdp.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
            codeElement.textContent = `${event.timestamp} ${event.type.toUpperCase()} →\n`;
            sdpText.split('\n').forEach(line => {
                codeElement.textContent += `${line}\n`;
            });
        } else {
            // ✅ Normal JSON objesini satırlandırarak yaz
            codeElement.textContent = `${event.timestamp} ${event.type.toUpperCase()} →\n${JSON.stringify(event.data, null, 2)}`;
        }

        preElement.appendChild(codeElement);
        details.appendChild(preElement);
        peerLogContainer.appendChild(details);

        // ✅ Prism.js renklendirme uygula
        if (window.Prism) {
            Prism.highlightElement(codeElement);
        }
    });

    peerConnectionDetails.appendChild(peerLogContainer);
    container.appendChild(peerConnectionDetails); 
    
    // ✅ Signaling Events - Zaman sıralı gösterim
    if (call.signalingEvents) {
        const signalingEventsFlat = [];
    
        // 🔃 signalEvents içindeki tüm key'leri sırala
        Object.keys(call.signalingEvents).forEach(eventType => {
            const entries = call.signalingEvents[eventType];
            if (Array.isArray(entries)) {
                entries.forEach(entry => {
                    signalingEventsFlat.push({ ...entry, type: eventType });
                });
            }
        });
    
        // 🔃 timestamp'e göre sırala
        signalingEventsFlat.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
        // 🔽 container oluştur
        const signalingDetails = document.createElement('details');
        signalingDetails.style.width = '100%';
        signalingDetails.style.marginBottom = '10px';
    
        const signalingSummary = document.createElement('summary');
        signalingSummary.textContent = "Signaling Events";
        signalingSummary.style.cursor = 'pointer';
        signalingSummary.style.fontWeight = 'bold';
        signalingDetails.appendChild(signalingSummary);
    
        // 🔁 Her bir event'i ekle
        signalingEventsFlat.forEach(event => {
            const subDetails = document.createElement('details');
            subDetails.open = true;
            const subSummary = document.createElement('summary');
            subSummary.textContent = `${event.timestamp} ${event.type}`;
            subSummary.style.cursor = 'pointer';
            subDetails.appendChild(subSummary);

    
            const pre = document.createElement('pre');
            pre.className = 'language-log';
            pre.style.whiteSpace = 'pre-wrap';
            pre.style.wordBreak = 'break-word';
            pre.style.overflowX = 'auto';
            pre.style.maxWidth = '100%';
    
            const code = document.createElement('code');
            code.className = 'language-log';
            code.textContent = event.message || JSON.stringify(event, null, 2);
    
            pre.appendChild(code);
            subDetails.appendChild(pre);
            signalingDetails.appendChild(subDetails);
    
            if (window.Prism) Prism.highlightElement(code);
        });
    
        container.appendChild(signalingDetails);
    }



    // ✅ Grafikler için zaman serisi verilerini ayarla
    const timestamps = call.connectionStats.map(stat => stat.timestamp || 'Unknown');
    console.log(timestamps, "timestamps ***")

    const metrics = [
  //    { name: 'Audio Upload Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.upload) || 0), unit: 'kbps' },
  //    { name: 'Audio Download Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.download) || 0), unit: 'kbps' },
  //    { name: 'Video Upload Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.upload) || 0), unit: 'kbps' },
  //    { name: 'Video Download Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.download) || 0), unit: 'kbps' },
        { name: 'Packet Loss', data: call.connectionStats.map(stat => parseInt(stat.packetLoss?.total) || 0), unit: 'Value' },
        {
            name: 'RTT (Round Trip Time)', 
            data: call.connectionStats.map(stat => {
                if (stat.transport && Array.isArray(stat.transport)) {
                    const srflx = stat.transport.find(t => t.localCandidateType === 'srflx' && t.rtt !== undefined);
                    if (srflx) return parseInt(srflx.rtt);
                    const fallback = stat.transport.find(t => t.rtt !== undefined);
                    return fallback ? parseInt(fallback.rtt) : 0;
                }
                return 0;
            }),
            unit: 'ms'
        }        
    ];
    // ✅ Video Upload & Download tek grafikte

    const videoUpload = call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.upload) || 0);
    const videoDownload = call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.download) || 0);

    if (videoUpload.some(v => v > 0) || videoDownload.some(v => v > 0)) {
        metrics.unshift({
            name: 'Video Upload/Download Bitrate',
            unit: 'kbps',
            data: [
                { name: 'Upload', data: videoUpload },
                { name: 'Download', data: videoDownload }
            ]
        });
    }

    // ✅ Audio Upload & Download tek grafikte
    const audioUpload = call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.upload) || 0);
    const audioDownload = call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.download) || 0);

   if (audioUpload.some(v => v > 0) || audioDownload.some(v => v > 0)) {
    metrics.unshift({
        name: 'Audio Upload/Download Bitrate',
        unit: 'kbps',
        data: [
            { name: 'Upload', data: audioUpload },
            { name: 'Download', data: audioDownload }
        ]
    });
}

   let widthSeries = [];
    let heightSeries = [];
    let framerateSeries = [];

    // ✅ Video Start Timestamp'i al
    const videoStartTimestamp = call.videoStartTimestamp || null;

    call.connectionStats.forEach(stat => {
        if (stat.resolution) {
            let parsedResolution;
            try {
                parsedResolution = JSON.parse(stat.resolution);
            } catch (e) {
                console.error("❌ Error parsing resolution:", e);
                return;
            }
    
            Object.keys(parsedResolution).forEach(streamId => {
                Object.keys(parsedResolution[streamId]).forEach(trackId => {
                    const resolutionData = parsedResolution[streamId][trackId];
    
                    const currentTimestamp = new Date(stat.timestamp).getTime();
    
                    // ✅ Sadece videoStartTimestamp'ten sonrasını ekle
                    if (!videoStartTimestamp || currentTimestamp >= videoStartTimestamp) {
    
                        if (resolutionData.width) {
                            const label = resolveTrackLabel(trackId);
                            let existingWidthSeries = widthSeries.find(series => series.name === `Width - ${label}`);
                            if (!existingWidthSeries) {
                                existingWidthSeries = { name: `Width - ${label}`, data: [] };
                                widthSeries.push(existingWidthSeries);
                            }
                            existingWidthSeries.data.push(resolutionData.width);
                        }
    
                        if (resolutionData.height) {
                            const label = resolveTrackLabel(trackId);
                            let existingHeightSeries = heightSeries.find(series => series.name === `Height - ${label}`);
                            if (!existingHeightSeries) {
                                existingHeightSeries = { name: `Height - ${label}`, data: [] };
                                heightSeries.push(existingHeightSeries);
                            }
                            existingHeightSeries.data.push(resolutionData.height);
                        }
    
                    } // end timestamp kontrolü
                });
            });
        }

        if (stat.framerate) {
            Object.keys(stat.framerate).forEach(streamId => {
                Object.keys(stat.framerate[streamId]).forEach(trackId => {
                    const label = resolveTrackLabel(trackId);
                    let existingSeries = framerateSeries.find(series => series.name === `Framerate - ${label}`);
                    if (!existingSeries) {
                        existingSeries = { name: `Framerate - ${label}`, data: [] };
                        framerateSeries.push(existingSeries);
                    }
            
                    const currentTimestamp = new Date(stat.timestamp).getTime();
            
                    // ✅ Sadece videoStartTimestamp'ten sonrasını ekle
                    if (!videoStartTimestamp || currentTimestamp >= videoStartTimestamp) {
                        existingSeries.data.push(stat.framerate[streamId][trackId]);
                    }
                });
            });
        }
    });

    if (widthSeries.length > 0 || heightSeries.length > 0) {
        const resolutionSeries = [...widthSeries, ...heightSeries];
        metrics.push({ name: 'Resolution (Width & Height)', data: resolutionSeries, unit: 'px' });
    }
    if (framerateSeries.length > 0) {
        metrics.push({ name: 'Framerate', data: framerateSeries, unit: 'fps' });
    }


// ✅ Grafikler Çiziliyor
metrics.forEach(metric => {
    // ✅ Timestamps'i filtrele
    let filteredTimestamps = timestamps;

    if ((metric.name === 'Framerate' || metric.name === 'Resolution (Width & Height)') && videoStartTimestamp) {
        filteredTimestamps = timestamps.filter(ts => {
            const tsTime = new Date(ts).getTime();
            return tsTime >= videoStartTimestamp;
        });
    }

    const chartContainer = document.createElement('div');
    chartContainer.style.minWidth = "450px";
    chartContainer.style.width = '45%';
    chartContainer.style.margin = '10px';
    
    container.appendChild(chartContainer);

    Highcharts.chart(chartContainer, {
        chart: { type: 'line', zoomType: 'x', panning: true, panKey: 'shift' },
        title: { text: metric.name },
        xAxis: {
            categories: (metric.name === 'Framerate' || metric.name === 'Resolution (Width & Height)') 
                ? filteredTimestamps 
                : timestamps,
            title: { text: 'Timestamp' },
            labels: { 
                rotation: -45,
                formatter: function () {
                    return this.value.split(' ')[1].slice(0, 8);
                }
            }
        },
        yAxis: { title: { text: metric.unit } },
        series: metric.name === 'Resolution (Width & Height)' || metric.name === 'Framerate' || metric.name === 'Video Upload/Download Bitrate' || metric.name === 'Audio Upload/Download Bitrate'
            ? metric.data 
            : [{ name: metric.name, data: metric.data }]
    });
});

}


