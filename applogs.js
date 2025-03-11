document.getElementById('logFileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];

    if (file) {
        const reader = new FileReader();

        reader.onload = function(e) {
            const logContent = e.target.result;
            parseLogFile(logContent);
        };

        reader.readAsText(file);
    }
});


let calls = [];

function parseLogFile(logContent) {
    const logLines = logContent.split('\n');
    calls = [];
    let currentCall = null;
    let collecting = false;

    for (let i = 0; i < logLines.length; i++) {
        const line = logLines[i];

        // ✅ conferenceWillJoin ile çağrıyı başlat
        if (line.includes("conferenceWillJoin received with data")) {
            collecting = true;
            currentCall = { 
                connectionStats: [],
                bipRoomName: null 
            };

            let jsonStr = line;
            while (i + 1 < logLines.length && !logLines[i + 1].includes("}")) {
                jsonStr += logLines[++i];
            }
            jsonStr += logLines[++i]; // JSON'un kapanış süslü parantezini ekle

            try {
                const jsonData = JSON.parse(jsonStr.match(/\{.*\}/s)[0]);
                if (jsonData.bipRoomName) {
                    currentCall.bipRoomName = jsonData.bipRoomName;
                    console.log(`🟢 New Call Started: bipRoomName = ${currentCall.bipRoomName}`);
                }
            } catch (e) {
                console.error("❌ JSON parse error in conferenceWillJoin:", e);
            }
        }

        // ✅ do leave satırları ile çağrıyı bitir
        if (collecting && line.includes("do leave")) {
            const leaveMatch = line.match(/do leave\s+([\w-]+)@/);
            if (leaveMatch && leaveMatch[1]) {
                const leaveBipRoomName = leaveMatch[1];

                console.log(`➡️ Found do leave bipRoomName: ${leaveBipRoomName}`);

                // Eğer alınan bipRoomName ile eşleşiyorsa çağrıyı bitir
                if (currentCall && currentCall.bipRoomName === leaveBipRoomName) {
                    collecting = false;

                    // ✅ ConnectionStats boş değilse çağrıyı ekle
                    if (currentCall.connectionStats.length > 0) {
                        calls.push(currentCall);
                        console.log("✅ Call successfully matched and ended:", currentCall);
                    } else {
                        console.warn("⚠️ Call ignored due to empty connectionStats:", currentCall);
                    }

                    currentCall = null;
                } else {
                    console.warn("⚠️ bipRoomName mismatch or no active call:", currentCall?.bipRoomName, leaveBipRoomName);
                }
            }
        }

       // ✅ "Got media constraints" satırlarını al (Tümünü kaydet)
        if (collecting && line.includes("Got media constraints")) {
            const mediaMatch = line.match(/\{.*\}/s);
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);

            if (mediaMatch && mediaMatch[0]) {
                try {
                    const parsedConstraints = JSON.parse(mediaMatch[0]); // Yeni medya kısıtlaması

                    // Eğer medya kısıtlamaları dizisi yoksa başlat
                    if (!currentCall.mediaConstraints) {
                        currentCall.mediaConstraints = [];
                    }

                    // ✅ Tarih bilgisini de ekle
                    if (timestampMatch && timestampMatch[1]) {
                        parsedConstraints.timestamp = timestampMatch[1];
                    }

                    // ✅ Medya kısıtlamasını diziye ekle
                    currentCall.mediaConstraints.push(parsedConstraints);
                    console.log(`🎙️ Media Constraints Captured:`, parsedConstraints);
                } catch (e) {
                    console.error("❌ Error parsing media constraints:", e);
                }
            }
        }


        // ✅ Eğer çağrı başladıysa, connection stats verilerini ekle
        if (collecting && currentCall && line.toLowerCase().includes('connection_stats')) {
            const statsJsonMatch = line.match(/CONNECTION_STATS.*?(\{.*\})/);
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            
            if (statsJsonMatch && statsJsonMatch[1]) {
                try {
                    const stats = JSON.parse(statsJsonMatch[1]);
                    if (timestampMatch && timestampMatch[1]) {
                        stats.timestamp = timestampMatch[1];
                    }
                    currentCall.connectionStats.push(stats);
                } catch (e) {
                    console.error('❌ Error parsing connection stats:', e);
                }
            }
        }
    }

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

    const dateInfo = document.createElement('h3');
    dateInfo.textContent = `Call Date: ${firstTimestamp}`;
    dateInfo.style.textAlign = 'center';
    dateInfo.style.width = '100%';
    dateInfo.style.marginBottom = '5px';
    container.appendChild(dateInfo);

    // ✅ Caller Number başlığını ekleyelim
    const callerInfo = document.createElement('h3');
    callerInfo.textContent = `Caller Number: ${callerNumber}`;
    callerInfo.style.textAlign = 'center';
    callerInfo.style.width = '100%';
    callerInfo.style.marginBottom = '10px';
    container.appendChild(callerInfo);

    if (call.mediaConstraints && call.mediaConstraints.length > 0) {
        const detailsContainer = document.createElement('details');
        detailsContainer.style.width = '100%';
        detailsContainer.style.marginBottom = '10px';

        const summary = document.createElement('summary');
        summary.textContent = " Media Constraints";
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = 'bold';
        detailsContainer.appendChild(summary);

        call.mediaConstraints.forEach((constraint, index) => {
            const constraintItem = document.createElement('pre');
            constraintItem.textContent = `[${constraint.timestamp}] ${JSON.stringify(constraint, null, 2)}`;
            constraintItem.style.padding = '5px';
            constraintItem.style.border = '1px solid #ccc';
            constraintItem.style.borderRadius = '5px';
            constraintItem.style.marginTop = '5px';
            constraintItem.style.whiteSpace = 'pre-wrap';
            constraintItem.style.backgroundColor = '#f9f9f9';
            constraintItem.style.fontSize = '12px';
            detailsContainer.appendChild(constraintItem);
        });

        container.appendChild(detailsContainer);

    }

    const timestamps = call.connectionStats.map(stat => stat.timestamp || 'Unknown');

    const metrics = [
        { name: 'Audio Upload Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.upload) || 0), unit: 'kbps' },
        { name: 'Audio Download Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.download) || 0), unit: 'kbps' },
        { name: 'Video Upload Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.upload) || 0), unit: 'kbps' },
        { name: 'Video Download Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.download) || 0), unit: 'kbps' },
        { name: 'Packet Loss', data: call.connectionStats.map(stat => parseInt(stat.packetLoss?.total) || 0), unit: 'Value' },
        { 
            name: 'RTT (Round Trip Time)', 
            data: call.connectionStats
                .filter(stat => stat.transport && stat.transport.some(transport => transport.localCandidateType === 'srflx'))
                .map(stat => {
                    const srflxTransport = stat.transport.find(transport => transport.localCandidateType === 'srflx');
                    return srflxTransport ? parseInt(srflxTransport.rtt) : 0;
                }),
            unit: 'Value'
        }
    ];

    let widthSeries = [];
    let heightSeries = [];
    let framerateSeries = [];
    
    call.connectionStats.forEach(stat => {
        // ✅ Resolution (Width & Height) Verileri
        if (stat.resolution) {
            let parsedResolution;
            try {
                parsedResolution = JSON.parse(stat.resolution); // JSON parse işlemi
              //  console.log("📏 Parsed Resolution Data:", parsedResolution);
            } catch (e) {
                console.error("❌ Error parsing resolution:", e);
                return;
            }
    
            Object.keys(parsedResolution).forEach(streamId => {
                Object.keys(parsedResolution[streamId]).forEach(trackId => {
                    const resolutionData = parsedResolution[streamId][trackId];
                  //  console.log(`📏 TrackID: ${trackId}, Width: ${resolutionData.width}, Height: ${resolutionData.height}`);
    
                    // ✅ Width ekleme
                    if (resolutionData.width) {
                        let existingWidthSeries = widthSeries.find(series => series.name === `Width - ${trackId}`);
                        if (!existingWidthSeries) {
                            existingWidthSeries = { name: `Width - ${trackId}`, data: [] };
                            widthSeries.push(existingWidthSeries);
                        }
                        existingWidthSeries.data.push(resolutionData.width);
                    }
    
                    // ✅ Height ekleme
                    if (resolutionData.height) {
                        let existingHeightSeries = heightSeries.find(series => series.name === `Height - ${trackId}`);
                        if (!existingHeightSeries) {
                            existingHeightSeries = { name: `Height - ${trackId}`, data: [] };
                            heightSeries.push(existingHeightSeries);
                        }
                        existingHeightSeries.data.push(resolutionData.height);
                    }
                });
            });
        }
    
        // ✅ Framerate Verileri
        if (stat.framerate) {
            Object.keys(stat.framerate).forEach(streamId => {
                Object.keys(stat.framerate[streamId]).forEach(trackId => {
                    let existingSeries = framerateSeries.find(series => series.name === `Framerate - ${trackId}`);
                    if (!existingSeries) {
                        existingSeries = { name: `Framerate - ${trackId}`, data: [] };
                        framerateSeries.push(existingSeries);
                    }
                    existingSeries.data.push(stat.framerate[streamId][trackId]);
                });
            });
        }
    });
    
 
    // ✅ Metrics'e ekleme
    if (widthSeries.length > 0) {
        metrics.push({ name: 'Width', data: widthSeries, unit: 'px' });
    }
    if (heightSeries.length > 0) {
        metrics.push({ name: 'Height', data: heightSeries, unit: 'px' });
    }
    if (framerateSeries.length > 0) {
        metrics.push({ name: 'Framerate', data: framerateSeries, unit: 'fps' });
    }
    
    // ✅ Highcharts'a veri gidiyor mu?
    //console.log("📈 Sending to Highcharts:", metrics);
    
    // ✅ Grafikler Çiziliyor
    metrics.forEach(metric => {
        const chartContainer = document.createElement('div');
        chartContainer.style.minWidth = "450px";
        chartContainer.style.width = '45%';
        chartContainer.style.margin = '10px';
    
        container.appendChild(chartContainer);
    
        Highcharts.chart(chartContainer, {
            chart: { type: 'line', zoomType: 'x', panning: true, panKey: 'shift' },
            title: { text: metric.name },
            xAxis: {
                categories: timestamps,
                title: { text: 'Timestamp' },
                labels: { 
                    rotation: -45,
                    formatter: function () {
                        return this.value.split(' ')[1].slice(0, 8);
                    }
                }
            },
            yAxis: { title: { text: metric.unit } },
            series: metric.name === 'Width' || metric.name === 'Height' || metric.name === 'Framerate' 
                ? metric.data 
                : [{ name: metric.name, data: metric.data }]
        });
    });
    
}
