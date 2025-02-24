import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AudioVisualizer from "./AudioVisualizer";
import "../../styles/RealtimeConnect.css";

function RealtimeConnect() {
  const { sessionId: urlSessionId } = useParams();
  const [sessionId] = useState(urlSessionId || "");
  const [log, setLog] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timer, setTimer] = useState(0);
  // remoteStream for playback/visualization
  const [remoteStream, setRemoteStream] = useState(null);
  // localStream is the microphone stream we send
  const [localStream, setLocalStream] = useState(null);
  const [interviewTitle, setInterviewTitle] = useState("Interview Session");
  const audioRef = useRef(null);
  const peerConnection = useRef(null);
  const navigate = useNavigate();
  const [volume, setVolume] = useState(1);
  // Prevent duplicate connection attempts (e.g., React StrictMode)
  const connectionInitiated = useRef(false);
  // AudioContext and gain node refs for routing remote audio
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);

  const appendLog = useCallback((msg) => {
    console.log("Log:", msg);
    setLog((prev) => prev + "\n" + msg);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!sessionId) {
      appendLog("No session ID provided");
      return alert("Need a session ID.");
    }

    appendLog("Starting connection process...");
    const token = localStorage.getItem("token");
    if (!token) {
      appendLog("Not logged in");
      return alert("You must be logged in first.");
    }

    try {
      // Cleanup any previous streams/connections
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
        gainNodeRef.current = null;
      }

      // 1) Get ephemeral token
      appendLog("Fetching ephemeral token...");
      const rtResp = await fetch(
        `https://demobackend-p2e1.onrender.com/realtime/token?session_id=${sessionId}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!rtResp.ok) throw new Error("Failed to get ephemeral token");
      const rtData = await rtResp.json();
      const ephemeralKey = rtData.client_secret.value;
      appendLog("Got ephemeral key: " + ephemeralKey.substring(0, 15) + "...");

      // 2) Create RTCPeerConnection
      appendLog("Creating RTCPeerConnection...");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.onconnectionstatechange = () => {
        appendLog(`Connection state changed: ${pc.connectionState}`);
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

      // 3) Get local audio stream and add its tracks
      appendLog("Getting user audio track...");
      const userStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      userStream.getTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      setLocalStream(userStream);
      userStream.getTracks().forEach((track) => {
        pc.addTrack(track, userStream);
      });

      // 4) Handle incoming remote audio track
      pc.ontrack = (evt) => {
        appendLog("🎵 Remote track received: " + evt.track.kind);
        if (evt.track.kind === "audio") {
          try {
            const incomingStream = evt.streams[0];
            appendLog(`Remote stream ID: ${incomingStream.id}`);
            appendLog(`Remote stream active: ${incomingStream.active}`);
            appendLog(
              `Audio tracks count: ${incomingStream.getAudioTracks().length}`
            );
            setRemoteStream(incomingStream);

            // Create or resume AudioContext for routing remote audio
            if (!audioContextRef.current) {
              const AudioContext =
                window.AudioContext || window.webkitAudioContext;
              audioContextRef.current = new AudioContext();
            }
            const audioCtx = audioContextRef.current;
            if (audioCtx.state === "suspended") {
              audioCtx.resume();
            }
            const source = audioCtx.createMediaStreamSource(incomingStream);
            // Create a gain node (store it in a ref for volume control)
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = volume;
            gainNodeRef.current = gainNode;
            source.connect(gainNode).connect(audioCtx.destination);
            appendLog("Audio routed via AudioContext.");

            // Also set up the audio element for fallback/visualization.
            if (audioRef.current) {
              audioRef.current.srcObject = null;
              audioRef.current.load();
              audioRef.current.srcObject = incomingStream;
              audioRef.current.volume = volume;
              audioRef.current.muted = false;
              const playPromise = audioRef.current.play();
              if (playPromise !== undefined) {
                playPromise
                  .then(() => {
                    appendLog(
                      "Playback started successfully (audio element)."
                    );
                  })
                  .catch((err) => {
                    appendLog(
                      `Audio element play failed: ${err.message}`
                    );
                    setTimeout(() => {
                      audioRef.current.play().catch(console.error);
                    }, 1000);
                  });
              }
            }
          } catch (err) {
            appendLog(`Audio setup error: ${err.message}`);
            console.error("Audio setup error:", err);
          }
        }
      };

      // 5) Create and send SDP offer using the mini realtime model
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      appendLog("Local SDP offer created.");

      // Use the mini realtime model
      const model = "gpt-4o-mini-realtime-preview-2024-12-17";
      const baseUrl = "https://api.openai.com/v1/realtime";
      const sdpResp = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpResp.ok)
        throw new Error("OpenAI Realtime handshake failed");
      const answerSDP = await sdpResp.text();
      appendLog("Received SDP answer from OpenAI.");

      await pc.setRemoteDescription({ type: "answer", sdp: answerSDP });
      appendLog("Remote SDP set.");

      peerConnection.current = pc;
      setIsConnected(true);
      appendLog("Setup complete - waiting for audio...");
    } catch (err) {
      appendLog(`Connection error: ${err.message}`);
      console.error("Connection error:", err);
      setIsConnected(false);
    }
  }, [sessionId, isMuted, appendLog, localStream, remoteStream, volume]);

  useEffect(() => {
    if (urlSessionId && !connectionInitiated.current) {
      connectionInitiated.current = true;
      handleConnect();
    }
    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        gainNodeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionId]);

  useEffect(() => {
    let interval;
    if (isConnected) {
      interval = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  useEffect(() => {
    const fetchInterviewDetails = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await fetch(
          `https://demobackend-p2e1.onrender.com/sessions/${sessionId}/details`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const data = await response.json();
        setInterviewTitle(data.interview_name || "Interview Session");
      } catch (err) {
        console.error("Error fetching interview details:", err);
      }
    };

    if (sessionId) {
      fetchInterviewDetails();
    }
  }, [sessionId]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const handleEndCall = async () => {
    try {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      setIsConnected(false);
      const token = localStorage.getItem("token");
      const response = await fetch(
        `https://demobackend-p2e1.onrender.com/sessions/${sessionId}/end`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (!response.ok) {
        throw new Error("Failed to end session on server");
      }
      navigate("/dashboard");
    } catch (err) {
      appendLog(`End call error: ${err.message}`);
      navigate("/dashboard");
    }
  };

  // Toggle mute on local audio stream
  const handleMuteToggle = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted((prev) => !prev);
      appendLog(`Microphone ${isMuted ? "unmuted" : "muted"}`);
    }
  };

  // Toggle pause/resume on local stream (stop/resume transmission)
  const handlePauseToggle = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.enabled = isPaused;
      });
      setIsPaused((prev) => !prev);
      appendLog(isPaused ? "Resumed" : "Paused");
    }
  };

  // When volume changes, update both audio element and gain node
  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVolume;
    }
    appendLog(`Volume set to ${newVolume}`);
  };

  // Handler to resume AudioContext on user gesture if needed
  const handleResumeAudio = () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().then(() => {
        appendLog("AudioContext resumed");
      });
    }
  };

  return (
    <div className="realtime-connect-container">
      <div className="interview-header">
        <h1>{interviewTitle}</h1>
      </div>

      <div className="interview-interface">
        <div className="visualizer-container">
          <AudioVisualizer mediaStream={remoteStream} />
          <div className="timer">{formatTime(timer)}</div>
        </div>

        <div className="controls">
          <button
            className={`control-button ${isMuted ? "active" : ""}`}
            onClick={handleMuteToggle}
            title={isMuted ? "Unmute" : "Mute"}
          >
            <img src="/assets/mute.svg" alt="Mute" className="control-icon" />
          </button>

          <button
            className="control-button end-call"
            onClick={handleEndCall}
            title="End Call"
          >
            <img src="/assets/call.svg" alt="End Call" className="control-icon" />
          </button>

          <button
            className={`control-button ${isPaused ? "active" : ""}`}
            onClick={handlePauseToggle}
            title={isPaused ? "Resume" : "Pause"}
          >
            <img src="/assets/pause.svg" alt="Pause" className="control-icon" />
          </button>

          <div className="volume-control">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={handleVolumeChange}
              style={{ width: "100px" }}
            />
          </div>
          {/* Button to manually resume AudioContext if needed */}
          <button onClick={handleResumeAudio} className="control-button">
            Resume Audio
          </button>
        </div>
      </div>

      <audio
        ref={audioRef}
        id="aiAudio"
        autoPlay
        playsInline
        preload="auto"
        style={{ display: "block", width: "100%" }}
        controls
      />
      <pre className="debug-log">{log}</pre>
    </div>
  );
}

export default RealtimeConnect;
