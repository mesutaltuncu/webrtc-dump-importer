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
let myNumber = null; 


function parseLogFile(logContent) {
    const logLines = logContent.split('\n');
    calls = [];
    let currentCall = null;
    let collecting = false;
    let foundMyNumber = false; // **Bir kez bulduktan sonra tekrar kontrol etmemek için**


    for (let i = 0; i < logLines.length; i++) {
        const line = logLines[i];

        // ✅ "My Jabber ID" satırını yakala ve numaranı al (Sadece bir kez bul yeterli)
        if (!foundMyNumber && line.includes("My Jabber ID:")) {
            const jabberMatch = line.match(/My Jabber ID:\s*(\d+)@/);
            if (jabberMatch && jabberMatch[1]) {
                myNumber = jabberMatch[1];
                foundMyNumber = true; // **Bulduktan sonra tekrar arama**
            }
        }

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
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            let endCallTimestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp"; // ✅ "do leave" satırındaki zamanı al

            if (leaveMatch && leaveMatch[1]) {
                const leaveBipRoomName = leaveMatch[1];

                console.log(`➡️ Found do leave bipRoomName: ${leaveBipRoomName} at ${endCallTimestamp}`);

                // Eğer alınan bipRoomName ile eşleşiyorsa çağrıyı bitir
                if (currentCall && currentCall.bipRoomName === leaveBipRoomName) {
                    collecting = false;

                    // ✅ End Call Date'i çağrı objesine ekle
                    currentCall.endCallDate = endCallTimestamp;

                    // Sıralama için
                    if (currentCall) {
                        let allEvents = [];

                        const addEvents = (events, type) => {
                            if (events && Array.isArray(events)) {
                                events.forEach(event => {
                                    if (event.timestamp) {
                                        allEvents.push({ ...event, type });
                                    }
                                });
                            }
                        };

                        addEvents(currentCall.mediaConstraints, "mediaConstraints");
                        addEvents(currentCall.create, "create");
                        addEvents(currentCall.createOffers, "createOffers");
                        addEvents(currentCall.onNegotiationNeeded, "onNegotiationNeeded");
                        addEvents(currentCall.createOfferOnSuccess, "createOfferOnSuccess");
                        addEvents(currentCall.signalingStates, "signalingStates");
                        addEvents(currentCall.onIceCandidates, "onIceCandidates");
                        addEvents(currentCall.onIceConnectionStateChanges, "onIceConnectionStateChanges");

                        allEvents.sort((a, b) => {
                            return new Date(a.timestamp) - new Date(b.timestamp);
                        });

                        currentCall.sortedEvents = allEvents;
                    }

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



     // ✅ "conferenceUpdateParticipant" satırlarını işle 
        if (collecting && line.includes("conferenceUpdateParticipant received with data")) {

            let jsonStr = line;

            // ✅ JSON'un kapanış süslü parantezlerini tam alana kadar devam et
            while (i + 1 < logLines.length && !logLines[i + 1].trim().endsWith("}")) {
                jsonStr += logLines[++i].trim(); // Boşlukları temizleyerek satırları birleştir
            }
            jsonStr += logLines[++i].trim(); // Son satırı ekle


            // ✅ "participants" içindeki tüm numaraları yakalayalım
            const participantsMatch = jsonStr.match(/"participants"\s*:\s*\{(.*?)\}/s);
            
            if (participantsMatch) {
                const participantsStr = participantsMatch[1]; // "participants" içeriğini al

                // ✅ Numara formatına uyan tüm değerleri toplayalım
                const participantNumbers = [...participantsStr.matchAll(/"(\d+)"\s*:\s*"(\d+)"/g)].map(match => match[2]);

                if (participantNumbers.length > 0) {

                    // ✅ Eğer participants dizisi yoksa oluştur
                    if (!currentCall.participants) {
                        currentCall.participants = [];
                    }

                    // ✅ Caller numarasını bipRoomName’den alalım
                    let callerNumber = "Unknown";
                    if (currentCall.bipRoomName) {
                        const match = currentCall.bipRoomName.match(/^(\d+)_/);
                        if (match && match[1]) {
                            callerNumber = match[1];
                        }
                    }


                    // ✅ Caller numarası ile karşılaştır ve farklı olanları participants dizisine ekle
                    participantNumbers.forEach(number => {
                        if (number !== callerNumber) {  
                            currentCall.participants.push(number);
                            console.log(`✅ Participant Added: ${number}`);
                        } else {
                            console.log(`⚠️ Skipping caller number (${number}), it's the same as the caller.`);
                        }
                    });

                    // ✅ Eğer çağrıyı biz başlatmadıysak ve numaramız listede yoksa, kendimizi participant olarak ekleyelim
                    if (myNumber && myNumber !== callerNumber && !currentCall.participants.includes(myNumber)) {
                        currentCall.participants.push(myNumber);
                        console.log(`✅ My Number (${myNumber}) Added as Participant (Not the Caller)`);
                    }

                } else {
                    console.warn("⚠️ No valid participants found, skipping.");
                }
            } else {
                console.warn("⚠️ 'participants' section not found.");
            }
        }

        // ✅ "createOfferOnSuccess" satırlarını al ve SDP'yi yakala
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createOfferOnSuccess::preTransform")) {

            let sdpLines = [];
            let timestamp = "Unknown Timestamp";

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            if (timestampMatch) {
                timestamp = timestampMatch[1];
            }

            sdpLines.push(line); // İlk satırı ekle

            // ✅ Yeni bir "postTransform" satırı görünene kadar satırları ekleyelim
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // ✅ Eğer "postTransform" satırı geldiyse SDP toplamayı bitir
                if (nextLine.includes("createOfferOnSuccess::postTransform (rtx modifier) undefined")) {
                    break;
                }

                sdpLines.push(nextLine);
            }

            // ✅ SDP içeriğini birleştir
            let sdpContent = sdpLines.join("\n").trim();

            // 🔴 HATA KONTROLÜ: `currentCall` Tanımlı Mı?
            if (!currentCall) {
                console.warn("⚠️ HATA: currentCall tanımsız! SDP kaydedilemedi.");
                return;
            }

            // 🔴 DEBUG: `currentCall` gerçekten aktif çağrı mı?
            console.log(`📞 Aktif Çağrı: ${currentCall.bipRoomName || "Unknown"}`);

            // Eğer createOfferOnSuccess dizisi yoksa başlat
            if (!currentCall.createOfferOnSuccess) {
                currentCall.createOfferOnSuccess = [];
            }

            // ✅ SDP'yi diziye ekle
            currentCall.createOfferOnSuccess.push({ timestamp, sdp: sdpContent });

            console.log(`📡 SDP Kaydedildi (${currentCall.bipRoomName} için):`, { timestamp, sdp: sdpContent });

            // 🔴 DEBUG: Şu anki çağrı objesini yazdıralım
            console.log("🔍 Güncellenmiş currentCall:", JSON.stringify(currentCall, null, 2));
        }

       // PEER CONNECTİONS SECTİON *****

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

        // ✅ "CreatePeerConnection pcConfig" satırlarını al ve kaydet CREATE deşdeğer
        if (collecting && line.includes("CreatePeerConnection pcConfig")) {
            const configMatch = line.match(/\{.*\}/s);
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);

            if (configMatch && configMatch[0]) {
                try {
                    const pcConfig = JSON.parse(configMatch[0]); // ✅ PeerConnection config JSON'u al

                    // Eğer create dizisi yoksa başlat
                    if (!currentCall.create) {
                        currentCall.create = [];
                    }

                    // ✅ Timestamp'i ekleyelim
                    const configData = { ...pcConfig };
                    if (timestampMatch && timestampMatch[1]) {
                        configData.timestamp = timestampMatch[1];
                    }

                    // ✅ Create dizisine ekle
                    currentCall.create.push(configData);
                    console.log(`🔗 PeerConnection Created:`, configData);
                } catch (e) {
                    console.error("❌ Error parsing CreatePeerConnection config:", e);
                }
            }
        }

        // ✅ "createOffer" satırlarını al (Tümünü kaydet)
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createOffer")) {
            const offerMatch = line.match(/\{.*\}/s);
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);

            if (offerMatch && offerMatch[0]) {
                try {
                    const parsedOffer = JSON.parse(offerMatch[0]); // ✅ Yeni createOffer JSON'u

                    // Eğer createOffer dizisi yoksa başlat
                    if (!currentCall.createOffers) {
                        currentCall.createOffers = [];
                    }

                    // ✅ Tarih bilgisini de ekle
                    if (timestampMatch && timestampMatch[1]) {
                        parsedOffer.timestamp = timestampMatch[1];
                    }

                    // ✅ createOffer'ı diziye ekle
                    currentCall.createOffers.push(parsedOffer);

                    // 🔴 Geçici Çözüm: Eğer 2. item varsa ve içinde "candidate" geçiyorsa onu kaldır
                    if (currentCall.createOffers.length > 1) {
                        const lastIndex = currentCall.createOffers.length - 1;
                        const lastOffer = currentCall.createOffers[lastIndex];

                        if ("candidate" in lastOffer) {
                            console.warn("⚠️ Candidate içeren gereksiz createOffer bulundu, kaldırılıyor:", lastOffer);
                            currentCall.createOffers.pop(); // Son elemanı kaldır
                        }
                    }
                } catch (e) {
                    console.error("❌ Error parsing createOffer:", e);
                }
            }
        }

        // ✅ "createOffer" satırlarını al (Tümünü kaydet)
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createOffer")) {

            let jsonStr = line;

            // JSON kapanış süslü parantezi yoksa devam eden satırları birleştir
            while (i + 1 < logLines.length && !logLines[i + 1].includes("}")) {
                jsonStr += logLines[++i];
            }
            jsonStr += logLines[++i]; // Kapanış süslü parantezini ekle

            const timestampMatch = jsonStr.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);

            try {
                const jsonMatch = jsonStr.match(/\{.*\}/s); // JSON içeriğini güvenli bir şekilde yakala
                if (jsonMatch) {
                    const parsedOffer = JSON.parse(jsonMatch[0]); // ✅ createOffer JSON'u al

                    // Eğer createOffer dizisi yoksa başlat
                    if (!currentCall.createOffers) {
                        currentCall.createOffers = [];
                    }

                    // ✅ Tarih bilgisini de ekle
                    if (timestampMatch && timestampMatch[1]) {
                        parsedOffer.timestamp = timestampMatch[1];
                    }

                    // ✅ createOffer'ı diziye ekle
                    currentCall.createOffers.push(parsedOffer);

                    // 🔴 Geçici Çözüm: Eğer 2. item varsa ve içinde "candidate" geçiyorsa onu kaldır
                    if (currentCall.createOffers.length > 1) {
                        const lastIndex = currentCall.createOffers.length - 1;
                        const lastOffer = currentCall.createOffers[lastIndex];

                        if ("candidate" in lastOffer) {
                            console.warn("⚠️ Candidate içeren gereksiz createOffer bulundu, kaldırılıyor:", lastOffer);
                            currentCall.createOffers.pop(); // Son elemanı kaldır
                        }
                    }
                }
            } catch (e) {
                console.error("❌ JSON Parse Error in createOffer:", e, jsonStr);
            }
        }

        // ✅ "onnegotiationneeded undefined" satırlarını al ve kaydet
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] onnegotiationneeded undefined")) {

            // Eğer dizimiz yoksa başlat
            if (!currentCall.onNegotiationNeeded) {
                currentCall.onNegotiationNeeded = [];
            }

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            // ✅ Bilgiyi diziye ekle
            currentCall.onNegotiationNeeded.push({ timestamp, value: "undefined" });

        }

      // ✅ "onsignalingstatechange" satırlarını al ve kaydet (Unknown'ları filtrele)
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] onsignalingstatechange")) {

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : null;

            // ✅ Signaling state bilgisini al
            const stateMatch = line.match(/onsignalingstatechange\s+(\S+)/);
            const signalingState = stateMatch ? stateMatch[1] : null;

            // ❌ Eğer signaling state "Unknown" veya boş ise kaydetme
            if (!signalingState || signalingState.toLowerCase() === "unknown") {
                console.warn("⚠️ Geçersiz onsignalingstatechange (Unknown), kaydedilmiyor:", line);
                return;
            }

            // Eğer signalingStates dizisi yoksa başlat
            if (!currentCall.signalingStates) {
                currentCall.signalingStates = [];
            }

            // ✅ Geçerli veriyi diziye ekle
            currentCall.signalingStates.push({ timestamp, state: signalingState });

        }

     // ✅ "onicecandidate" satırlarını al ve tam JSON'u kaydet
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] onicecandidate")) {

            let candidateStr = line; // İlk satırı ekle

            // ✅ JSON kapanış süslü parantezi `}` görene kadar devam eden satırları birleştir
            while (i + 1 < logLines.length && !logLines[i + 1].includes("}")) {
                candidateStr += logLines[++i];
            }
            candidateStr += logLines[++i]; // Son satırı da ekle (JSON'un kapanış parantezi)

            // ✅ Timestamp'i al
            const timestampMatch = candidateStr.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            try {
                // ✅ JSON nesnesini yakala ve parse et
                const jsonMatch = candidateStr.match(/\{.*\}/s);
                if (jsonMatch) {
                    const candidateData = JSON.parse(jsonMatch[0]);

                    // Eğer `onIceCandidates` dizisi yoksa başlat
                    if (!currentCall.onIceCandidates) {
                        currentCall.onIceCandidates = [];
                    }

                    // ✅ Timestamp'i ekleyelim
                    candidateData.timestamp = timestamp;

                    // ✅ `onIceCandidates` dizisine ekle
                    currentCall.onIceCandidates.push(candidateData);
                }
            } catch (e) {
                console.error("❌ Error parsing onicecandidate:", e, candidateStr);
            }
        }

        // ✅ "addIceCandidate" satırlarını al ve tam JSON'u kaydet
    if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] addIceCandidate")) {

        let candidateStr = line; // İlk satırı ekle

        // ✅ JSON kapanış süslü parantezi `}` görene kadar devam eden satırları birleştir
        while (i + 1 < logLines.length && !logLines[i + 1].includes("}")) {
            candidateStr += logLines[++i];
        }
        candidateStr += logLines[++i]; // Son satırı da ekle (JSON'un kapanış parantezi)

        // ✅ Timestamp'i al
        const timestampMatch = candidateStr.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        try {
            // ✅ JSON nesnesini yakala ve parse et
            const jsonMatch = candidateStr.match(/\{.*\}/s);
            if (jsonMatch) {
                const candidateData = JSON.parse(jsonMatch[0]);

                // Eğer `addIceCandidates` dizisi yoksa başlat
                if (!currentCall.addIceCandidates) {
                    currentCall.addIceCandidates = [];
                }

                // ✅ Timestamp'i ekleyelim
                candidateData.timestamp = timestamp;

                // ✅ `addIceCandidates` dizisine ekle
                currentCall.addIceCandidates.push(candidateData);
            }
        } catch (e) {
            console.error("❌ Error parsing addIceCandidate:", e, candidateStr);
        }
    }

     // ✅ "oniceconnectionstatechange" satırlarını al ve kaydet
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] oniceconnectionstatechange")) {

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            // ✅ ICE connection state bilgisini al (oniceconnectionstatechange kelimesinden sonraki ilk kelimeyi)
            const stateMatch = line.match(/oniceconnectionstatechange\s+(\S+)/);
            const iceConnectionState = stateMatch ? stateMatch[1] : null;

            // ❌ Eğer ICE connection state boş veya "Unknown" ise kaydetme
            if (!iceConnectionState || iceConnectionState.toLowerCase() === "unknown") {
                console.warn("⚠️ Geçersiz oniceconnectionstatechange (Unknown), kaydedilmiyor:", line);
                return;
            }

            // Eğer onIceConnectionStateChanges dizisi yoksa başlat
            if (!currentCall.onIceConnectionStateChanges) {
                currentCall.onIceConnectionStateChanges = [];
            }

            // ✅ Bilgiyi diziye ekle
            currentCall.onIceConnectionStateChanges.push({ timestamp, state: iceConnectionState });

        }

        // ✅ "setRemoteDescriptionOnSuccess" satırlarını al ve kaydet
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] setRemoteDescriptionOnSuccess")) {

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            // ✅ "type: offer" veya "type: answer" değerini yakala (Doğru Regex)
            const typeMatch = line.match(/type:\s*(offer|answer)/);
            const descriptionType = typeMatch ? typeMatch[1] : "Unknown";

            // Eğer setRemoteDescriptionOnSuccess dizisi yoksa başlat
            if (!currentCall.setRemoteDescriptionOnSuccess) {
                currentCall.setRemoteDescriptionOnSuccess = [];
            }

            // ✅ Bilgiyi diziye ekle
            currentCall.setRemoteDescriptionOnSuccess.push({ timestamp, type: descriptionType });

        }

        // ✅ "setLocalDescriptionOnSuccess" satırlarını al ve SDP'yi yakala
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] setLocalDescriptionOnSuccess")) {

            let sdpLines = [];
            let timestamp = "Unknown Timestamp";

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            if (timestampMatch) {
                timestamp = timestampMatch[1];
            }

            sdpLines.push(line); // İlk satırı ekle

            // ✅ Yeni bir "getLocalDescription::preTransform" satırı görünene kadar satırları ekleyelim
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // ✅ Eğer "getLocalDescription::preTransform" satırı geldiyse SDP toplamayı bitir
                if (nextLine.includes("[modules/RTC/TraceablePeerConnection.js] getLocalDescription::preTransform")) {
                    break;
                }

                sdpLines.push(nextLine);
            }

            // ✅ SDP içeriğini birleştir
            let sdpContent = sdpLines.join("\n").trim();

            // 🔴 HATA KONTROLÜ: `currentCall` Tanımlı Mı?
            if (!currentCall) {
                console.warn("⚠️ HATA: currentCall tanımsız! SDP kaydedilemedi.");
                return;
            }

            // 🔴 DEBUG: `currentCall` gerçekten aktif çağrı mı?
            console.log(`📞 Aktif Çağrı: ${currentCall.bipRoomName || "Unknown"}`);

            // Eğer setLocalDescriptionOnSuccess dizisi yoksa başlat
            if (!currentCall.setLocalDescriptionOnSuccess) {
                currentCall.setLocalDescriptionOnSuccess = [];
            }

            // ✅ SDP'yi diziye ekle
            currentCall.setLocalDescriptionOnSuccess.push({ timestamp, sdp: sdpContent });

            console.log(`📡 SDP Kaydedildi (${currentCall.bipRoomName} için):`, { timestamp, sdp: sdpContent });

            // 🔴 DEBUG: Şu anki çağrı objesini yazdıralım
            console.log("🔍 Güncellenmiş currentCall:", JSON.stringify(currentCall, null, 2));
        }



        // PEER CONNECTİONS SECTİON ENDED  *****

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


    let participantNumbers = "No Participants";
    if (call.participants && call.participants.length > 0) {
        participantNumbers = call.participants.join(", ");
    }

    const dateInfo = document.createElement('p');
    dateInfo.textContent = `Call Date: ${firstTimestamp}`;
    dateInfo.style.textAlign = 'center';
    dateInfo.style.width = '100%';
    dateInfo.style.marginBottom = '5px';
    dateInfo.style.fontSize = '16px'; 
    dateInfo.style.fontWeight = 'bold';
    dateInfo.style.color = '#000';
    container.appendChild(dateInfo);
    
    const endCallInfo = document.createElement('p');
    endCallInfo.textContent = `End Call Date: ${call.endCallDate || "Unknown"}`;
    endCallInfo.style.textAlign = 'center';
    endCallInfo.style.width = '100%';
    endCallInfo.style.marginBottom = '10px';
    endCallInfo.style.fontSize = '16px'; 
    endCallInfo.style.fontWeight = 'bold';
    endCallInfo.style.color = '#000';
    container.appendChild(endCallInfo);
    
    const callerInfo = document.createElement('p');
    callerInfo.textContent = `Caller Number: ${callerNumber} | Bip Room Name: ${call.bipRoomName || "Unknown"}`;
    callerInfo.style.textAlign = 'center';
    callerInfo.style.width = '100%';
    callerInfo.style.marginBottom = '10px';
    callerInfo.style.fontSize = '16px'; 
    callerInfo.style.fontWeight = 'bold';
    callerInfo.style.color = '#000';
    container.appendChild(callerInfo);
    
    const participantInfo = document.createElement('p');
    participantInfo.textContent = `Participants: ${participantNumbers}`;
    participantInfo.style.textAlign = 'center';
    participantInfo.style.width = '100%';
    participantInfo.style.marginBottom = '10px';
    participantInfo.style.fontSize = '16px'; 
    participantInfo.style.fontWeight = 'bold';
    participantInfo.style.color = '#000';
    container.appendChild(participantInfo);
    



    // ✅ Media Constraints
    if (call.mediaConstraints && call.mediaConstraints.length > 0) {
        const detailsContainer = document.createElement('details');
        detailsContainer.style.width = '100%';
        detailsContainer.style.marginBottom = '10px';

        const summary = document.createElement('summary');
        summary.textContent = " Media Constraints";
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = 'bold';
        detailsContainer.appendChild(summary);

        call.mediaConstraints.forEach((constraint) => {
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

    // ✅ PeerConnection Updates Açılır/Kapanır Yapı
    const peerConnectionDetails = document.createElement('details');
    peerConnectionDetails.style.width = '100%';
    peerConnectionDetails.style.marginBottom = '10px';

    const peerSummary = document.createElement('summary');
    peerSummary.textContent = "🔗 PeerConnection Updates";
    peerSummary.style.cursor = 'pointer';
    peerSummary.style.fontWeight = 'bold';
    peerConnectionDetails.appendChild(peerSummary);

    const peerLogContainer = document.createElement('div');
    peerLogContainer.style.fontFamily = 'monospace';
    peerLogContainer.style.whiteSpace = 'pre-wrap';
    peerLogContainer.style.marginLeft = '20px';

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
    addEvent(call.onNegotiationNeeded, "onnegotiationneeded");
    addEvent(call.signalingStates, "onsignalingstatechange");
    addEvent(call.onIceCandidates, "onicecandidate");
    addEvent(call.onIceConnectionStateChanges, "oniceconnectionstatechange");
    addEvent(call.createOfferOnSuccess, "createOfferOnSuccess");
    addEvent(call.addIceCandidates, "addIceCandidates");
    addEvent(call.setLocalDescriptionOnSuccess, "setLocalDescriptionOnSuccess");
    addEvent(call.setRemoteDescriptionOnSuccess, "setRemoteDescriptionOnSuccess");

    
    // ✅ Olayları timestamp'e göre sırala
    allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // ✅ Açılır kapanır yapıya ekleyelim
    allEvents.forEach(event => {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `${event.timestamp} ▶ ${event.type}`;
        summary.style.cursor = 'pointer';
        details.appendChild(summary);

        const contentContainer = document.createElement('div');
        contentContainer.style.padding = '5px';
        contentContainer.style.border = '1px solid #ccc';
        contentContainer.style.borderRadius = '5px';
        contentContainer.style.marginTop = '5px';
        contentContainer.style.whiteSpace = 'pre-wrap';
        contentContainer.style.backgroundColor = '#f9f9f9';
        contentContainer.style.fontSize = '12px';
        
        // Eğer event createOfferOnSuccess ise ve içinde SDP varsa, satır satır göstermek için parçala
        if (event.type === "createOfferOnSuccess" || "setLocalDescriptionOnSuccess" && event.data.sdp) {
            const sdpLines = event.data.sdp.split("\n");
            sdpLines.forEach(line => {
                const lineElement = document.createElement('div');
                lineElement.textContent = line;
                contentContainer.appendChild(lineElement);
            });
        } else {
            // Diğer JSON içeriklerini normal şekilde gösterelim
            contentContainer.textContent = JSON.stringify(event.data, null, 2);
        }
        
        details.appendChild(contentContainer);
        peerLogContainer.appendChild(details);
        
    });

    peerConnectionDetails.appendChild(peerLogContainer);
    container.appendChild(peerConnectionDetails);

    // ✅ Grafikler için zaman serisi verilerini ayarla
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
            unit: 'ms'
        }
    ];

    // ✅ Grafikler Çiziliyor (Grafik kısmına dokunulmadı)
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
            series: [{ name: metric.name, data: metric.data }]
        });
    });
}


