function parseLogLine(line) {
    const logRegex =
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) (\w+) (\w+) (.*)$/;
    const match = line.match(logRegex);
    if (!match) return null;

    const [, timestamp, level, tag, message] = match;

    let data = null;
    const objMatch = message.match(/\{.*\}/s);
    if (objMatch) {
        let jsonLike = objMatch[0];

        // 1. Anahtarları tırnak içine al ve '=' yerine ':' koy
        jsonLike = jsonLike.replace(/([{,]\s*)([A-Za-z0-9_]+)=/g, '$1"$2":');

        // 2. String değerleri tırnak içine al
        // Eğer değer saf sayı değilse veya harfle başlıyorsa, tırnak içine al
        jsonLike = jsonLike.replace(/:\s*([^,\}]+)/g, (m, value) => {
            // Sayı değilse veya http gibi harfle başlıyorsa tırnak ekle
            if (!/^\d+(\.\d+)?$/.test(value.trim())) {
                return ': "' + value.trim() + '"';
            }
            return ": " + value.trim();
        });

        try {
            data = JSON.parse(jsonLike);
        } catch (e) {
            console.error("JSON parse hatası:", e, jsonLike);
        }
    }

    return {
        timestamp,
        level,
        tag,
        message,
        data,
    };
}

function parseAndroidLine(line, state) {
    const { logLines } = state;

    // ✅ My Jabber ID
    if (!state.foundMyNumber && line.includes("My Jabber ID:")) {
        const jabberMatch = line.match(/My Jabber ID:\s*(\d+)@/);
        if (jabberMatch && jabberMatch[1]) {
            state.myNumber = jabberMatch[1];
            state.foundMyNumber = true; // **Bulduktan sonra tekrar arama**
        }
    }

    // ✅ conferenceWillJoin → bipRoomName
    if (state.collecting && line.includes("Conference will join")) {

        const jsonData = parseLogLine(line).data;

        if (jsonData.bipRoomName && state.currentCall) {
            state.currentCall.bipRoomName = jsonData.bipRoomName;
        }
    }

    // ✅  Got media constraints
    if (state.collecting && line.includes("Got media constraints")) {
        const mediaMatch = line.match(/\{.*\}/s);
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);

        if (mediaMatch && mediaMatch[0]) {
            try {
                const parsedConstraints = JSON.parse(mediaMatch[0]);
                if (!state.currentCall.mediaConstraints) {
                    state.currentCall.mediaConstraints = [];
                }
                if (timestampMatch && timestampMatch[1]) {
                    parsedConstraints.timestamp = timestampMatch[1];
                }
                state.currentCall.mediaConstraints.push(parsedConstraints);
            } catch (e) {
                console.error("❌ Error parsing media constraints:", e);
            }
        }
    }

    // ✅  Call başlatıcı loglar
    if (!state.collecting && (
        line.includes("setCallState as OUTGOING") ||
        line.includes("setCallState as INCOMING")
    )) {
        state.collecting = true;
        state.currentCall = {
            connectionStats: [],
            bipRoomName: null,
            signalingEvents: {},
            remoteCandidateType: null,
            localCandidateType: null,
            codecInfo: null

        };
        console.log("📞 Yeni çağrı başlangıcı bulundu:", line, state);
    }

    // ✅  Call State Changed from ended → çağrıyı bitir
    if (state.collecting && line.includes("setCallState as END")) {
        state.collecting = false;

        if (state.currentCall) {
            if (state.currentCall.connectionStats.length > 0) {
                state.calls.push(state.currentCall);
                console.log("✅ Call finalized at 'Call State Changed from ended':", state.currentCall);
            } else {
                console.warn("⚠️ Call ended but ignored due to empty connectionStats:", state.currentCall);
            }
            state.currentCall = null;
        }
    }

    //  do leave satırları ile çağrının bitişini işaretle (henüz bitirme!)
    if (state.collecting && line.includes("do leave")) {
        const leaveMatch = line.match(/do leave\s+([\w-]+)@/);
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        let endCallTimestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (leaveMatch && leaveMatch[1]) {
            const leaveBipRoomName = leaveMatch[1];
            if (state.currentCall && state.currentCall.bipRoomName === leaveBipRoomName) {
                state.currentCall.endCallDate = endCallTimestamp;
                console.log(`⏸️ Call marked to end, waiting for \"Call State Changed from ended\" → ${leaveBipRoomName}`);
            }
        }
    }

    // PEER CONNECTİONS SECTİON *****

    // ✅ createOfferOnSuccess satırlarını al ve SDP'yi yakala
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createOfferOnSuccess::preTransform")) {
        let sdpLines = [];
        let timestamp = "Unknown Timestamp";

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        console.log("busraa createOfferOnSuccess ", timestamp)
        if (timestampMatch) {
            timestamp = timestampMatch[1];
        }

        sdpLines.push(line);

        while (state.i + 1 < logLines.length) {
            const nextLine = logLines[++state.i];
            if (nextLine.includes("createOfferOnSuccess::postTransform (rtx modifier) undefined")) {
                break;
            }
            sdpLines.push(nextLine);
        }

        const sdpContent = sdpLines.join("\n").trim();

        if (!state.currentCall) {
            console.warn("⚠️ HATA: currentCall tanımsız! SDP kaydedilemedi.");
            return;
        }

        if (!state.currentCall.createOfferOnSuccess) {
            state.currentCall.createOfferOnSuccess = [];
        }

        state.currentCall.createOfferOnSuccess.push({ timestamp, sdp: sdpContent });
    }

    // ✅ conferenceUpdateParticipant satırlarını işle
    if (state.collecting && line.includes("submitAction: ParticipantUpdate")) {
        // bipRoomName'i yakala
        const roomMatch = line.match(/bipRoomName=([^,}]+)/);
        if (roomMatch) {
            state.currentCall.bipRoomName = roomMatch[1];
        }

        // participants={...} kısmını yakala
        const participantsMatch = line.match(/participants=\{([^}]*)\}/);
        if (participantsMatch) {
            const participantsStr = participantsMatch[1].trim();

            if (participantsStr.length > 0) {
                // Android loglarda genelde "12345=67890" gibi eşleşmeler olur
                const participantNumbers = [...participantsStr.matchAll(/(\d+)=?(\d+)?/g)]
                    .map(match => match[2] || match[1]); // ikinci değer yoksa ilkini al

                if (participantNumbers.length > 0) {
                    if (!state.currentCall.participants) {
                        state.currentCall.participants = [];
                    }

                    let callerNumber = "Unknown";
                    if (state.currentCall.bipRoomName) {
                        const match = state.currentCall.bipRoomName.match(/^(\d+)_/);
                        if (match && match[1]) {
                            callerNumber = match[1];
                        }
                    }

                    participantNumbers.forEach(number => {
                        if (number !== callerNumber) {
                            state.currentCall.participants.push(number);
                        } else {
                            console.log(`⚠️ Skipping caller number (${number}), it's the same as the caller.`);
                        }
                    });

                    if (
                        state.myNumber &&
                        state.myNumber !== callerNumber &&
                        !state.currentCall.participants.includes(state.myNumber)
                    ) {
                        state.currentCall.participants.push(state.myNumber);
                    }
                } else {
                    console.warn("⚠️ No valid participants found, skipping.");
                }
            } else {
                console.warn("⚠️ Participants section is empty.");
            }
        } else {
            console.warn("⚠️ 'participants' section not found.");
        }
    }

    // ✅ CreatePeerConnection pcConfig satırlarını al ve kaydet
    if (state.collecting && line.includes("CreatePeerConnection pcConfig")) {
        const configMatch = line.match(/\{.*\}/s);
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);

        if (configMatch && configMatch[0]) {
            try {
                const pcConfig = JSON.parse(configMatch[0]);

                if (!state.currentCall.create) {
                    state.currentCall.create = [];
                }

                const configData = { ...pcConfig };
                if (timestampMatch && timestampMatch[1]) {
                    configData.timestamp = timestampMatch[1];
                }

                state.currentCall.create.push(configData);
            } catch (e) {
                console.error("❌ Error parsing CreatePeerConnection config:", e);
            }
        }
    }

    // ✅ createOffer satırlarını al ve JSON'u yakala
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createOffer ")) {
        let offerStr = line;
        let jsonContent = "";
        let timestamp = "Unknown Timestamp";

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timestampMatch) {
            timestamp = timestampMatch[1];
        }

        while (state.i + 1 < logLines.length) {
            const nextLine = logLines[++state.i];

            if (nextLine.match(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/)) {
                console.warn("⚠️ Stopping createOffer capture due to new timestamp.");
                state.i--; // Geri al
                break;
            }

            offerStr += nextLine;

            if (nextLine.includes("}")) {
                jsonContent = offerStr.match(/\{.*\}/s);
                break;
            }
        }

        try {
            if (jsonContent) {
                const offerData = JSON.parse(jsonContent[0]);

                if (!state.currentCall.createOffers) {
                    state.currentCall.createOffers = [];
                }

                offerData.timestamp = timestamp;
                state.currentCall.createOffers.push(offerData);
                console.log("✅ createOffer captured:", offerData);
            } else {
                console.warn("⚠️ No valid JSON content found for createOffer.");
            }
        } catch (e) {
            console.error("❌ Error parsing createOffer JSON:", e, jsonContent);
        }
    }

    // ✅ createAnswer satırlarını al ve JSON'u yakala
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createAnswer ")) {
        let answerStr = line;
        let jsonContent = "";
        let timestamp = "Unknown Timestamp";

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timestampMatch) {
            timestamp = timestampMatch[1];
        }

        while (state.i + 1 < logLines.length) {
            const nextLine = logLines[++state.i];

            if (nextLine.match(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/)) {
                console.warn("⚠️ Stopping createAnswer capture due to new timestamp.");
                state.i--; // Bir satır geri al
                break;
            }

            answerStr += nextLine;

            if (nextLine.includes("}")) {
                jsonContent = answerStr.match(/\{.*\}/s);
                break;
            }
        }

        try {
            if (jsonContent) {
                const answerData = JSON.parse(jsonContent[0]);

                if (!state.currentCall.createAnswers) {
                    state.currentCall.createAnswers = [];
                }

                answerData.timestamp = timestamp;
                state.currentCall.createAnswers.push(answerData);
                console.log("✅ createAnswer captured:", answerData);
            } else {
                console.warn("⚠️ No valid JSON content found for createAnswer.");
            }
        } catch (e) {
            console.error("❌ Error parsing createAnswer JSON:", e, jsonContent);
        }
    }

    // ✅ onnegotiationneeded undefined satırlarını al ve kaydet
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] onnegotiationneeded undefined")) {
        if (!state.currentCall.onNegotiationNeeded) {
            state.currentCall.onNegotiationNeeded = [];
        }

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        state.currentCall.onNegotiationNeeded.push({ timestamp, value: "undefined" });
    }

    // ✅ onsignalingstatechange satırlarını al ve kaydet
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] onsignalingstatechange")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : null;

        const stateMatch = line.match(/onsignalingstatechange\s+(\S+)/);
        const signalingState = stateMatch ? stateMatch[1] : null;

        if (!signalingState || signalingState.toLowerCase() === "unknown") {
            console.warn("⚠️ Geçersiz onsignalingstatechange (Unknown), kaydedilmiyor:", line);
            return;
        }

        if (!state.currentCall.signalingStates) {
            state.currentCall.signalingStates = [];
        }

        state.currentCall.signalingStates.push({ timestamp, state: signalingState });
    }

    // ✅ onicecandidate satırlarını al ve tam JSON'u kaydet
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] onicecandidate {")) {
        let candidateStr = line;
        let jsonContent = "";

        while (state.i + 1 < logLines.length) {
            const nextLine = logLines[++state.i];

            if (nextLine.includes("[modules/RTC/TraceablePeerConnection.js] getLocalDescription::preTransform")) {
                console.warn("⚠️ Stopping onIceCandidate capture due to 'getLocalDescription::preTransform' line.");
                state.i--; // bir satır geri al
                break;
            }

            candidateStr += nextLine;

            if (nextLine.includes("}")) {
                jsonContent = candidateStr.match(/\{.*\}/s);
                break;
            }
        }

        const timestampMatch = candidateStr.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        try {
            if (jsonContent) {
                const candidateData = JSON.parse(jsonContent[0]);

                if (!state.currentCall.onIceCandidates) {
                    state.currentCall.onIceCandidates = [];
                }

                candidateData.timestamp = timestamp;
                state.currentCall.onIceCandidates.push(candidateData);
            } else {
                console.warn("⚠️ No valid JSON content found for onicecandidate.");
            }
        } catch (e) {
            console.error("❌ Error parsing onicecandidate JSON:", e, jsonContent);
        }
    }

    // ✅ addIceCandidate satırlarını al ve tam JSON'u kaydet
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] addIceCandidate")) {
        let candidateStr = line;
        let jsonContent = "";

        // JSON kapanana kadar satırları birleştir
        while (state.i + 1 < logLines.length && !logLines[state.i + 1].includes("}")) {
            candidateStr += logLines[++state.i];
        }
        candidateStr += logLines[++state.i]; // JSON kapanış satırını da ekle

        const timestampMatch = candidateStr.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        try {
            const jsonMatch = candidateStr.match(/\{.*\}/s);
            if (jsonMatch) {
                const candidateData = JSON.parse(jsonMatch[0]);

                if (!state.currentCall.addIceCandidates) {
                    state.currentCall.addIceCandidates = [];
                }

                candidateData.timestamp = timestamp;
                state.currentCall.addIceCandidates.push(candidateData);
            } else {
                console.warn("⚠️ No JSON content found for addIceCandidate.");
            }
        } catch (e) {
            console.error("❌ Error parsing addIceCandidate JSON:", e, candidateStr);
        }
    }

    // ✅ "oniceconnectionstatechange" satırlarını al ve kaydet
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] oniceconnectionstatechange")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        const stateMatch = line.match(/oniceconnectionstatechange\s+(\S+)/);
        const iceConnectionState = stateMatch ? stateMatch[1] : null;

        if (!iceConnectionState || iceConnectionState.toLowerCase() === "unknown") {
            console.warn("⚠️ Geçersiz oniceconnectionstatechange (Unknown), kaydedilmiyor:", line);
            return;
        }

        if (!state.currentCall.onIceConnectionStateChanges) {
            state.currentCall.onIceConnectionStateChanges = [];
        }

        state.currentCall.onIceConnectionStateChanges.push({ timestamp, state: iceConnectionState });
    }

    // ✅ "setRemoteDescriptionOnSuccess" satırlarını al ve yeni bir tarih satırı görene kadar devam et
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] setRemoteDescriptionOnSuccess")) {
        let sdpLines = [];
        let timestamp = "Unknown Timestamp";

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timestampMatch) {
            timestamp = timestampMatch[1];
        }

        sdpLines.push(line);

        while (state.i + 1 < logLines.length) {
            const nextLine = logLines[++state.i];
            if (nextLine.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)) {
                state.i--;
                break;
            }
            sdpLines.push(nextLine);
        }

        const sdpContent = sdpLines.join("\n").trim();

        if (!state.currentCall) {
            console.warn("⚠️ HATA: currentCall tanımsız! SDP kaydedilemedi.");
            return;
        }

        // ✅ remoteSsrcs dizisini başlat
        if (!state.currentCall.remoteSsrcs) {
            state.currentCall.remoteSsrcs = [];
        }

        // ✅ Tüm ssrc'leri bul ve tekrarsız ekle
        const ssrcMatches = [...sdpContent.matchAll(/a=ssrc:(\d+)\s/g)];
        ssrcMatches.forEach(match => {
            const ssrc = match[1];
            if (!state.currentCall.remoteSsrcs.includes(ssrc)) {
                state.currentCall.remoteSsrcs.push(ssrc);
            }
        });

        console.log("📡 Remote SSRC'ler kaydedildi:", state.currentCall.remoteSsrcs);

        if (!state.currentCall.setRemoteDescriptionOnSuccess) {
            state.currentCall.setRemoteDescriptionOnSuccess = [];
        }

        state.currentCall.setRemoteDescriptionOnSuccess.push({ timestamp, sdp: sdpContent });
    }

    // ✅ "createAnswerOnSuccess" satırlarını al ve yeni bir tarih satırı görene kadar devam et
    if (state.collecting && line.includes("[modules/RTC/TraceablePeerConnection.js] createAnswerOnSuccess::preTransform")) {
        console.log("🟢 createAnswerOnSuccess başlangıcı bulundu!");

        let sdpLines = [];
        let timestamp = "Unknown Timestamp";

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timestampMatch) {
            timestamp = timestampMatch[1];
        }

        sdpLines.push(line); // İlk satır

        while (state.i + 1 < logLines.length) {
            const nextLine = logLines[++state.i];

            if (nextLine.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)) {
                console.log("⏹️ Yeni bir timestamp bulundu, createAnswerOnSuccess yakalama tamamlandı.");
                state.i--; // Yeni satırı tekrar işleriz
                break;
            }

            sdpLines.push(nextLine);
        }

        const sdpContent = sdpLines.join("\n").trim();

        if (!state.currentCall) {
            console.warn("⚠️ HATA: currentCall tanımsız! SDP kaydedilemedi.");
            return;
        }

        if (!state.currentCall.createAnswerOnSuccess) {
            state.currentCall.createAnswerOnSuccess = [];
        }

        state.currentCall.createAnswerOnSuccess.push({ timestamp, sdp: sdpContent });
    }

    // ✅ Ice Gathering State değişimlerini al
    if (state.collecting && line.includes("[features/base/conference] Ice gathering state changed:")) {
        console.log(`📡 Ice Gathering Log Line: ${line}`);

        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        const stateMatch = line.match(/Ice gathering state changed:\s*([\w-]+)/);
        const gatheringState = stateMatch ? stateMatch[1].trim() : "Unknown";

        if (gatheringState !== "Unknown") {
            if (!state.currentCall.iceGatheringStates) {
                state.currentCall.iceGatheringStates = [];
            }

            state.currentCall.iceGatheringStates.push({ timestamp, state: gatheringState });

            console.log(`✅ Ice Gathering State Saved: ${gatheringState} at ${timestamp}`);
        } else {
            console.warn(`⚠️ Ice gathering state could not be parsed in line: ${line}`);
        }
    }

    // ✅ "[WebrtcModule] ERROR -" hatalarını al ve sakla
    if (state.collecting && line.includes("[WebrtcModule] ERROR -")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        const errorMessage = line.split("[WebrtcModule] ERROR -")[1]?.trim() || "Unknown Error";

        if (!state.currentCall.webrtcModuleErrors) {
            state.currentCall.webrtcModuleErrors = [];
        }

        state.currentCall.webrtcModuleErrors.push({ timestamp, message: errorMessage });
    }

    // ✅ Audio Session configured log entry
    if (state.collecting && line.includes("[CallModule][Audio Session] - Audio session configured.")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.audioSessionConfigured) {
            state.currentCall.signalingEvents.audioSessionConfigured = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.audioSessionConfigured.push(entry);

        console.log("🔊 Audio Session Configured Logged:", entry);
    }

    // ✅ Call Event Fired: ... loglarını yakala (startFromVoipPN, mediaEstablished, vs.)
    if (state.collecting && line.includes("CallStartManager makeCall for")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";
        if (!state.currentCall.signalingEvents.callEventsFired) {
            state.currentCall.signalingEvents.callEventsFired = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.callEventsFired.push(entry);

        console.log("🚀 Call Event Fired Logged:", entry);
    }

    // ✅ "[Connection]: State is updated. State: Authenticated" satırlarını al
    if (state.collecting && line.includes("XmppConnectionManager authenticated")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.connectionStateUpdates) {
            state.currentCall.signalingEvents.connectionStateUpdates = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.connectionStateUpdates.push(entry);

        console.log("🌐 Connection Auth State Logged:", entry);
    }

    // ✅ "[CallModule][Message] - Initiate message received" satırlarını al
    if (state.collecting && line.includes("MessageManager onReceiptReceived")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.initiateMessages) {
            state.currentCall.signalingEvents.initiateMessages = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.initiateMessages.push(entry);

        console.log("📨 Initiate message received:", entry);
    }


    // ✅ "[CallModule][Message] - Info message sent to:" bloklarını al (çok satırlı)
    if (state.collecting && line.includes("P2PCallApiImpl sendInfoMessage, to:")) {
        const infoBlock = [line];
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.infoMessages) {
            state.currentCall.signalingEvents.infoMessages = [];
        }

        const entry = {
            timestamp,
            message: infoBlock.join("\n").trim()
        };

        state.currentCall.signalingEvents.infoMessages.push(entry);

        console.log("📤 Info message sent block:", entry);
    }

    // ✅ Network değişimi satırını al ve JSON'u parse et
    if (state.collecting && line.includes("[features/base/net-info] Network changed")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        const jsonMatch = line.match(/\{.*\}$/s); // Satır sonundaki JSON'u al
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                state.currentCall.signalingEvents.networkChanged = {
                    timestamp,
                    data: parsed
                };
                console.log("🌐 Network değişimi tespit edildi:", parsed);
            } catch (e) {
                console.warn("⚠️ Network JSON parse hatası:", e);
            }
        }
    }

    // ✅ Terminate message sent to ... bloğunu yakala (çok satırlı)
    if (state.collecting && line.includes("P2PCallManager handleTerminate ")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        const terminateLines = [line];

        state.currentCall.signalingEvents.terminateMessageSent = {
            timestamp,
            message: terminateLines.join('\n').trim()
        };

        console.log("📤 Terminate message sent block logged:", state.currentCall.signalingEvents.terminateMessageSent);
    }

    // ✅ IQ sent satırını yakala (yalnızca <q xmlns="vc"> içerenler)
    if (state.collecting && line.includes('IQ sent: <iq type="get"') && line.includes('<q xmlns="vc">')) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.iqSent) {
            state.currentCall.signalingEvents.iqSent = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.iqSent.push(entry);

        console.log('📡 IQ Sent (with <q xmlns="vc">) Logged:', entry);
    }

    // ✅ Jitsi token request mesajını yakala
    if (state.collecting && line.includes("PushHelper token registration start")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.tokenRequest) {
            state.currentCall.signalingEvents.tokenRequest = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.tokenRequest.push(entry);

        console.log("🔐 Token Request Logged:", entry);
    }

    // ✅ P2PCallManager tokenResponseTimer - tüm timer loglarını yakala
    if (state.collecting && line.includes("P2PCallManager tokenResponseTimer")) {
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.timerLogs) {
            state.currentCall.signalingEvents.timerLogs = [];
        }

        const entry = {
            timestamp,
            message: line.trim()
        };

        state.currentCall.signalingEvents.timerLogs.push(entry);

        console.log("⏱️ Timer log captured:", entry);
    }

    // ✅ "Terminate message parsing succeeded" bloklarını al (çok satırlı)
    if (state.collecting && line.includes("P2PCallApiImpl sendTerminateMessage, to:")) {
        const terminateParseBlock = [line];
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
        const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

        if (!state.currentCall.signalingEvents.terminateParsing) {
            state.currentCall.signalingEvents.terminateParsing = [];
        }

        const entry = {
            timestamp,
            message: terminateParseBlock.join("\n").trim()
        };

        state.currentCall.signalingEvents.terminateParsing.push(entry);

        console.log("🛑 Terminate Parsing Block:", entry);
    }

    // ✅ Route Change Reason logunu (isActive: 1 geldiğinde) sadece 1 kere logla
    if (state.collecting && line.includes("Route Change Reason, Configuration Change")) {
        const routeChangeBlock = [line];
        let j = state.i + 1;
        let blockContainsActive1 = false;

        while (j < logLines.length && !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}:\d{3}/.test(logLines[j])) {
            const nextLine = logLines[j];
            routeChangeBlock.push(nextLine);

            if (nextLine.includes("isActive: 1")) {
                blockContainsActive1 = true;
            }

            j++;
        }

        state.i = j - 1;

        // ✅ Sadece bir kez isActive: 1 içeren blok loglansın
        if (!state.currentCall.signalingEvents.routeChangeLogged) {
            if (blockContainsActive1) {
                const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
                const timestamp = timestampMatch ? timestampMatch[1] : "Unknown Timestamp";

                if (!state.currentCall.signalingEvents.routeChanges) {
                    state.currentCall.signalingEvents.routeChanges = [];
                }

                state.currentCall.signalingEvents.routeChanges.push({
                    timestamp,
                    message: routeChangeBlock.join('\n').trim()
                });

                state.currentCall.signalingEvents.routeChangeLogged = true; // ✅ Bir daha loglama
                console.log("✅ Route Change (isActive: 1) logged:", timestamp);
            }
        }
    }

    // ✅ Tüm "Sending source-add for" satırlarından SSRC'leri toplayarak bir dizi oluştur
    if (state.collecting && line.includes("Sending source-add for") && line.includes("ssrcs=")) {
        const ssrcListMatch = line.match(/ssrcs=([\d,]+)/);
        if (ssrcListMatch && ssrcListMatch[1]) {
            const ssrcs = ssrcListMatch[1].split(',').map(s => s.trim());

            if (!state.currentCall.ssrcs) {
                state.currentCall.ssrcs = [];
            }

            ssrcs.forEach(ssrc => {
                if (!state.currentCall.ssrcs.includes(ssrc)) {
                    state.currentCall.ssrcs.push(ssrc);
                }
            });

            console.log("📡 SSRCs updated:", state.currentCall.ssrcs);
        }
    }

    // ✅ Eğer çağrı başladıysa, connection stats verilerini ekle
    if (state.collecting && state.currentCall && line.toLowerCase().includes("connection_stats")) {
        const statsJsonMatch = line.match(/CONNECTION_STATS.*?(\{.*\})/);
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);

        if (statsJsonMatch && statsJsonMatch[1]) {
            try {
                const stats = JSON.parse(statsJsonMatch[1]);

                if (timestampMatch && timestampMatch[1]) {
                    stats.timestamp = timestampMatch[1];
                }

                // ✅ Eğer `transport` dizisi varsa, remote ve local candidate bilgilerini al
                if (stats.transport && stats.transport.length > 0) {
                    const transportData = stats.transport[0];
                    state.currentCall.remoteCandidateType = transportData.remoteCandidateType || "N/A";
                    state.currentCall.localCandidateType = transportData.localCandidateType || "N/A";
                }

                // ✅ codec bilgisi varsa ve daha önce işlenmediyse işle
                if (
                    stats.codec &&
                    typeof stats.codec === "string" &&
                    (
                        state.currentCall.codecInfo === null ||
                        (typeof state.currentCall.codecInfo === 'object' && Object.keys(state.currentCall.codecInfo).length === 0)
                    )
                ) {
                    try {
                        const parsedCodec = JSON.parse(stats.codec);
                        if (Object.keys(parsedCodec).length > 0) {
                            state.currentCall.codecInfo = parsedCodec;
                            console.log("🎯 Codec info extracted from CONNECTION_STATS:", parsedCodec);
                        } else {
                            console.log("⚠️ Empty codec object skipped");
                        }
                    } catch (e) {
                        console.warn("❌ Codec JSON parse failed:", e);
                    }
                }

                state.currentCall.connectionStats.push(stats);
            } catch (e) {
                console.error("❌ Error parsing connection stats:", e);
            }
        }
    }




}

// Fonksiyonu global scope'a ekle
window.parseAndroidLine = parseAndroidLine;