// interview-frontend/src/components/RealtimeConnect.js
import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import AudioVisualizer from "./AudioVisualizer";
import styles from "./realtimeconnect.module.css";

function RealtimeConnect() {
  const { sessionId } = useParams();
  const [log, setLog] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [callInfo, setCallInfo] = useState({
    title: "Reach - Demo Interview",
    host: "The Reach Team",
    price: "$5.00 call"
  });
  
  // Reference to the remote MediaStream for AI audio
  const remoteMediaStreamRef = useRef(new MediaStream());
  // Reference for the audio element
  const audioRef = useRef(null);

  function appendLog(msg) {
    console.log("Log:", msg);
    setLog((prev) => prev + "\n" + msg);
  }

  useEffect(() => {
    // Auto-connect when component mounts if we have a sessionId
    if (sessionId) {
      handleConnect();
    }
  }, [sessionId]);

  async function handleConnect() {
    setIsConnecting(true);
    appendLog("Starting connection process...");

    // 0) Get JWT token from localStorage.
    const jwtToken = localStorage.getItem("token");
    if (!jwtToken) return alert("You must be logged in first.");
    if (!sessionId) return alert("Need a session ID.");

    try {
      // 1) Get ephemeral token from your backend.
      appendLog("Fetching ephemeral token...");
      const rtResp = await fetch(`http://localhost:8000/realtime/token?session_id=${sessionId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${jwtToken}` },
      });
      if (!rtResp.ok) throw new Error("Failed to get ephemeral token");
      const rtData = await rtResp.json();
      const ephemeralKey = rtData.client_secret.value;
      appendLog("Got ephemeral key: " + ephemeralKey.substring(0, 15) + "...");

      // 2) Create local RTCPeerConnection.
      appendLog("Creating RTCPeerConnection...");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.onconnectionstatechange = () => {
        appendLog(`Connection state changed: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
          setCallActive(true);
          setIsConnecting(false);
        } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
          setCallActive(false);
        }
      };
      pc.oniceconnectionstatechange = () => {
        appendLog(`ICE connection state: ${pc.iceConnectionState}`);
      };
      pc.onicegatheringstatechange = () => {
        appendLog(`ICE gathering state: ${pc.iceGatheringState}`);
      };
      pc.onsignalingstatechange = () => {
        appendLog(`Signaling state: ${pc.signalingState}`);
      };

      // 3) Add the user's microphone audio.
      appendLog("Adding user audio track...");
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // 4) Set up ontrack handler to play incoming audio.
      pc.ontrack = (evt) => {
        appendLog("🎵 Track received: " + evt.track.kind);
        if (evt.track.kind === "audio") {
          try {
            // Store the AI audio stream in the ref for the visualizer
            remoteMediaStreamRef.current = evt.streams[0];
            
            const audioEl = audioRef.current;
            if (!audioEl) {
              appendLog(" Audio element not found!");
              return;
            }
            
            // Set the stream to the audio element
            audioEl.srcObject = evt.streams[0];
            audioEl.volume = 1.0;
            audioEl.play()
              .then(() => appendLog("Playback started"))
              .catch((err) => appendLog(`Play failed: ${err.message}`));
          } catch (err) {
            appendLog(`Audio setup error: ${err.message}`);
          }
        }
      };

      // 5) Create a local SDP offer.
      const offer = await pc.createOffer();
      appendLog("Local SDP offer created.");
      await pc.setLocalDescription(offer);

      // 6) Wait for ICE gathering to complete.
      await new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          const checkState = () => {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", checkState);
        }
      });
      appendLog("ICE gathering complete.");

      // 7) Send the SDP offer to the OpenAI Realtime API.
      appendLog("Sending SDP offer to OpenAI Realtime API...");
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResp = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpResp.ok) throw new Error("OpenAI Realtime handshake failed");
      const answerSDP = await sdpResp.text();
      appendLog("Received SDP answer from OpenAI.");

      // 8) Set the remote SDP.
      await pc.setRemoteDescription({ type: "answer", sdp: answerSDP });
      appendLog("Remote SDP set.");
      appendLog("Setup complete - waiting for audio...");
    } catch (err) {
      appendLog(`Connection error: ${err.message}`);
      console.error("Connection error:", err);
      alert("Connection error: " + err.message);
      setIsConnecting(false);
    }
  }

  const handleEndCall = () => {
    // Implementation to end the call
    setCallActive(false);
    // Add logic to close the WebRTC connection
    window.history.back();
  };

  return (
    <div className={styles.container}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        id="aiAudio"
        autoPlay
        style={{ display: "none" }}
      />
      
      {/* Call header */}
      <div className={styles.callHeader}>
        <div className={styles.callPrice}>{callInfo.price}</div>
        <div className={styles.callTitle}>{callInfo.title}</div>
        <div className={styles.callHost}>{callInfo.host}</div>
      </div>
      
      {/* Visualizer area */}
      <div className={styles.visualizerContainer}>
        {isConnecting ? (
          <div className={styles.connecting}>Connecting...</div>
        ) : (
          <AudioVisualizer mediaStream={remoteMediaStreamRef.current} />
        )}
      </div>
      
      {/* Call controls */}
      <div className={styles.controlsContainer}>
        <button className={`${styles.controlButton} ${styles.micButton}`}>
          <i className="microphone-icon">🎙️</i>
        </button>
        <button className={`${styles.controlButton} ${styles.optionsButton}`}>
          <i className="options-icon">⋯</i>
        </button>
        <button 
          className={`${styles.controlButton} ${styles.endCallButton}`}
          onClick={handleEndCall}
        >
          <i className="end-call-icon">✕</i>
        </button>
      </div>
      
      {/* Debug log - can be hidden in production */}
      {process.env.NODE_ENV === 'development' && (
        <pre className={styles.debugLog}>
          {log}
        </pre>
      )}
    </div>
  );
}

export default RealtimeConnect;
