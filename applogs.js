document.getElementById('logFileInput').addEventListener('change', function(event) {
    const file = event.target.files[0];

    if (file) {
        document.getElementById('loadingMessage').style.display = 'block'; 
        const reader = new FileReader();

        reader.onload = function(e) {
            const logContent = e.target.result;
            parseLogFile(logContent);

            document.getElementById('loadingMessage').style.display = 'none'; 
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

                    // // Sıralama için
                    // if (currentCall) {
                    //     let allEvents = [];

                    //     const addEvents = (events, type) => {
                    //         if (events && Array.isArray(events)) {
                    //             events.forEach(event => {
                    //                 if (event.timestamp) {
                    //                     allEvents.push({ ...event, type });
                    //                 }
                    //             });
                    //         }
                    //     };

                    //     addEvents(currentCall.mediaConstraints, "mediaConstraints");
                    //     addEvents(currentCall.create, "create");
                    //     addEvents(currentCall.createOffers, "createOffers");
                    //     addEvents(currentCall.onNegotiationNeeded, "onNegotiationNeeded");
                    //     addEvents(currentCall.createOfferOnSuccess, "createOfferOnSuccess");
                    //     addEvents(currentCall.signalingStates, "signalingStates");
                    //     addEvents(currentCall.onIceCandidates, "onIceCandidates");
                    //     addEvents(currentCall.onIceConnectionStateChanges, "onIceConnectionStateChanges");

                    //     allEvents.sort((a, b) => {
                    //         return new Date(a.timestamp) - new Date(b.timestamp);
                    //     });

                    //     currentCall.sortedEvents = allEvents;
                    // }

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
                        } else {
                            console.log(`⚠️ Skipping caller number (${number}), it's the same as the caller.`);
                        }
                    });

                    // ✅ Eğer çağrıyı biz başlatmadıysak ve numaramız listede yoksa, kendimizi participant olarak ekleyelim
                    if (myNumber && myNumber !== callerNumber && !currentCall.participants.includes(myNumber)) {
                        currentCall.participants.push(myNumber);
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

            // Eğer createOfferOnSuccess dizisi yoksa başlat
            if (!currentCall.createOfferOnSuccess) {
                currentCall.createOfferOnSuccess = [];
            }

            // ✅ SDP'yi diziye ekle
            currentCall.createOfferOnSuccess.push({ timestamp, sdp: sdpContent });
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
                } catch (e) {
                    console.error("❌ Error parsing CreatePeerConnection config:", e);
                }
            }
        }

        // ✅ "createOffer" satırlarını al ve JSON'u yakala
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createOffer")) {
            let offerStr = line; // İlk satırı ekle
            let jsonContent = "";
            let timestamp = "Unknown Timestamp";

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            if (timestampMatch) {
                timestamp = timestampMatch[1];
            }

            // ✅ JSON kapanış süslü parantezi `}` görene kadar devam eden satırları birleştir
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // Eğer yeni bir tarih satırı geldiyse işlemi durdur
                if (nextLine.match(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/)) {
                    console.warn("⚠️ Stopping createOffer capture due to new timestamp.");
                    i--; // Bir satır geri al ki sonraki if koşulları bozulmasın
                    break;
                }

                offerStr += nextLine;

                // JSON kapanış parantezini gördüysek işlemi sonlandır
                if (nextLine.includes("}")) {
                    jsonContent = offerStr.match(/\{.*\}/s);
                    break;
                }
            }

            try {
                if (jsonContent) {
                    const offerData = JSON.parse(jsonContent[0]);

                    // Eğer createOffers dizisi yoksa başlat
                    if (!currentCall.createOffers) {
                        currentCall.createOffers = [];
                    }

                    // ✅ Timestamp'i ekleyelim
                    offerData.timestamp = timestamp;

                    // ✅ `createOffers` dizisine ekle
                    currentCall.createOffers.push(offerData);
                    console.log("✅ createOffer captured:", offerData);
                } else {
                    console.warn("⚠️ No valid JSON content found for createOffer.");
                }
            } catch (e) {
                console.error("❌ Error parsing createOffer JSON:", e, jsonContent);
            }
        }

        // ✅ "createAnswer" satırlarını al ve JSON'u yakala
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createAnswer")) {
            let answerStr = line; // İlk satırı ekle
            let jsonContent = "";
            let timestamp = "Unknown Timestamp";

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            if (timestampMatch) {
                timestamp = timestampMatch[1];
            }

            // ✅ JSON kapanış süslü parantezi `}` görene kadar devam eden satırları birleştir
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // Eğer yeni bir tarih satırı geldiyse işlemi durdur
                if (nextLine.match(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/)) {
                    console.warn("⚠️ Stopping createAnswer capture due to new timestamp.");
                    i--; // Bir satır geri al ki sonraki if koşulları bozulmasın
                    break;
                }

                answerStr += nextLine;

                // JSON kapanış parantezini gördüysek işlemi sonlandır
                if (nextLine.includes("}")) {
                    jsonContent = answerStr.match(/\{.*\}/s);
                    break;
                }
            }

            try {
                if (jsonContent) {
                    const answerData = JSON.parse(jsonContent[0]);

                    // Eğer createAnswers dizisi yoksa başlat
                    if (!currentCall.createAnswers) {
                        currentCall.createAnswers = [];
                    }

                    // ✅ Timestamp'i ekleyelim
                    answerData.timestamp = timestamp;

                    // ✅ `createAnswers` dizisine ekle
                    currentCall.createAnswers.push(answerData);
                    console.log("✅ createAnswer captured:", answerData);
                } else {
                    console.warn("⚠️ No valid JSON content found for createAnswer.");
                }
            } catch (e) {
                console.error("❌ Error parsing createAnswer JSON:", e, jsonContent);
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

      // ✅ "onsignalingstatechange" satırlarını al ve kaydet (Unknown'ları filtrele) ***********
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
            let jsonContent = "";

            // ✅ JSON kapanış süslü parantezi `}` görene kadar devam eden satırları birleştir
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // Eğer `getLocalDescription::preTransform` satırını görürsek, işlemeyi durdur
                if (nextLine.includes("[modules/RTC/TraceablePeerConnection.js] getLocalDescription::preTransform")) {
                    console.warn("⚠️ Stopping onIceCandidate capture due to 'getLocalDescription::preTransform' line.");
                    i--; // Bir satır geri al ki sonraki if koşulları bozulmasın
                    break;
                }

                candidateStr += nextLine;

                // JSON kapanış parantezini gördüysek işlemi sonlandır
                if (nextLine.includes("}")) {
                    jsonContent = candidateStr.match(/\{.*\}/s);
                    break;
                }
            }

            // ✅ Timestamp'i al
            const timestampMatch = candidateStr.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            try {
                if (jsonContent) {
                    const candidateData = JSON.parse(jsonContent[0]);

                    // Eğer `onIceCandidates` dizisi yoksa başlat
                    if (!currentCall.onIceCandidates) {
                        currentCall.onIceCandidates = [];
                    }

                    // ✅ Timestamp'i ekleyelim
                    candidateData.timestamp = timestamp;

                    // ✅ `onIceCandidates` dizisine ekle
                    currentCall.onIceCandidates.push(candidateData);
                } else {
                    console.warn("⚠️ No valid JSON content found for onicecandidate.");
                }
            } catch (e) {
                console.error("❌ Error parsing onicecandidate JSON:", e, jsonContent);
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

       // ✅ "setRemoteDescriptionOnSuccess" satırlarını al ve yeni bir tarih satırı görene kadar devam et
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] setRemoteDescriptionOnSuccess")) {

            let sdpLines = [];
            let timestamp = "Unknown Timestamp";

            // ✅ İlk satırdan timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            if (timestampMatch) {
                timestamp = timestampMatch[1];
            }

            sdpLines.push(line); // İlk satırı ekle

            // ✅ Yeni bir timestamp satırı görene kadar satırları al
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // ✅ Eğer yeni bir tarih formatında satır geldiyse SDP toplamayı bitir
                if (nextLine.match(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/)) {
                    i--; // Geri bir adım at, çünkü yeni timestamp satırını tekrar işlememiz gerekecek
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

            // Eğer setRemoteDescriptionOnSuccess dizisi yoksa başlat
            if (!currentCall.setRemoteDescriptionOnSuccess) {
                currentCall.setRemoteDescriptionOnSuccess = [];
            }

            // ✅ SDP'yi diziye ekle
            currentCall.setRemoteDescriptionOnSuccess.push({ timestamp, sdp: sdpContent });

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

            // Eğer setLocalDescriptionOnSuccess dizisi yoksa başlat
            if (!currentCall.setLocalDescriptionOnSuccess) {
                currentCall.setLocalDescriptionOnSuccess = [];
            }

            // ✅ SDP'yi diziye ekle
            currentCall.setLocalDescriptionOnSuccess.push({ timestamp, sdp: sdpContent });
        }

        // ✅ "createAnswerOnSuccess" satırlarını al ve yeni bir tarih satırı görene kadar devam et
        if (collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createAnswerOnSuccess::preTransform")) {
            console.log("🟢 createAnswerOnSuccess başlangıcı bulundu!");

            let sdpLines = [];
            let timestamp = "Unknown Timestamp";

            // ✅ İlk satırdan timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            if (timestampMatch) {
                timestamp = timestampMatch[1];
            }

            sdpLines.push(line); // İlk satırı ekle

            // ✅ Yeni bir timestamp satırı görene kadar satırları al
            while (i + 1 < logLines.length) {
                const nextLine = logLines[++i];

                // ✅ Eğer yeni bir tarih formatında satır geldiyse SDP toplamayı bitir
                if (nextLine.match(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/)) {
                    console.log("⏹️ Yeni bir timestamp bulundu, createAnswerOnSuccess yakalama tamamlandı.");
                    i--; // Geri bir adım at, çünkü yeni timestamp satırını tekrar işlememiz gerekecek
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

            // Eğer createAnswerOnSuccess dizisi yoksa başlat
            if (!currentCall.createAnswerOnSuccess) {
                currentCall.createAnswerOnSuccess = [];
            }

            // ✅ SDP'yi diziye ekle
            currentCall.createAnswerOnSuccess.push({ timestamp, sdp: sdpContent });
        }

       // ✅ Ice Gathering State değişimlerini al
        if (collecting && line.includes("[features/base/conference] Ice gathering state changed:")) {
            console.log(`📡 Ice Gathering Log Line: ${line}`);

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            // ✅ State değerini al (gathering, complete vb.)
            const stateMatch = line.match(/Ice gathering state changed:\s*([\w-]+)/);
            const state = stateMatch ? stateMatch[1].trim() : "Unknown";

            if (state !== "Unknown") {
                // Eğer iceGatheringStates dizisi yoksa başlat
                if (!currentCall.iceGatheringStates) {
                    currentCall.iceGatheringStates = [];
                }

                // ✅ Ice gathering state bilgisini diziye ekle
                currentCall.iceGatheringStates.push({ timestamp, state });

                console.log(`✅ Ice Gathering State Saved: ${state} at ${timestamp}`);
            } else {
                console.warn(`⚠️ Ice gathering state could not be parsed in line: ${line}`);
            }
        }

        // ✅ "[WebrtcModule] ERROR -" hatalarını al ve sakla
        if (collecting && line.includes("[WebrtcModule] ERROR -")) {

            // ✅ Timestamp'i al
            const timestampMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3})/);
            const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

            // ✅ Hata mesajını al
            const errorMessage = line.split("[WebrtcModule] ERROR -")[1].trim();

            if (!currentCall.webrtcModuleErrors) {
                currentCall.webrtcModuleErrors = [];
            }

            currentCall.webrtcModuleErrors.push({ timestamp, message: errorMessage });
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

    // ✅ Grafikler için zaman serisi verilerini ayarla
    const timestamps = call.connectionStats.map(stat => stat.timestamp || 'Unknown');

    const metrics = [
  //    { name: 'Audio Upload Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.upload) || 0), unit: 'kbps' },
  //    { name: 'Audio Download Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.audio?.download) || 0), unit: 'kbps' },
  //    { name: 'Video Upload Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.upload) || 0), unit: 'kbps' },
  //    { name: 'Video Download Bitrate', data: call.connectionStats.map(stat => parseInt(stat.bitrate?.video?.download) || 0), unit: 'kbps' },
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

                    if (resolutionData.width) {
                        let existingWidthSeries = widthSeries.find(series => series.name === `Width - ${trackId}`);
                        if (!existingWidthSeries) {
                            existingWidthSeries = { name: `Width - ${trackId}`, data: [] };
                            widthSeries.push(existingWidthSeries);
                        }
                        existingWidthSeries.data.push(resolutionData.width);
                    }

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

    if (widthSeries.length > 0 || heightSeries.length > 0) {
        const resolutionSeries = [...widthSeries, ...heightSeries];
        metrics.push({ name: 'Resolution (Width & Height)', data: resolutionSeries, unit: 'px' });
    }
    if (framerateSeries.length > 0) {
        metrics.push({ name: 'Framerate', data: framerateSeries, unit: 'fps' });
    }


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
            series: metric.name === 'Resolution (Width & Height)' || metric.name === 'Framerate' || metric.name === 'Video Upload/Download Bitrate' || metric.name === 'Audio Upload/Download Bitrate'
                ? metric.data 
                : [{ name: metric.name, data: metric.data }]
        });
    });
}


