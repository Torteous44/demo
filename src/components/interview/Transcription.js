import React, { useEffect, useRef, useState } from 'react';
import styles from './transcription.module.css';

function Transcription({ 
  transcripts, 
  remoteMediaStream, 
  localStream, 
  isCallActive,
  onTranscriptReceived
}) {
  // Add local state for transcripts to ensure we have a fallback
  const [localTranscripts, setLocalTranscripts] = useState([]);
  const [aiTranscriptionInitialized, setAiTranscriptionInitialized] = useState(false);
  const [userTranscriptionInitialized, setUserTranscriptionInitialized] = useState(false);
  
  // Refs for WebSockets and audio processing
  const aiAssemblyWsRef = useRef(null);
  const aiAudioContextRef = useRef(null);
  const aiProcessorRef = useRef(null);
  const userAssemblyWsRef = useRef(null);
  const userAudioContextRef = useRef(null);
  const userProcessorRef = useRef(null);
  const lastTranscriptRef = useRef({
    text: '',
    speaker: '',
    timestamp: ''
  });

  // Helper function for audio conversion
  function convertFloat32ToInt16(buffer) {
    const l = buffer.length;
    const buf = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return buf.buffer;
  }

  // Helper function to log with timestamps
  const logWithTime = (message) => {
    console.log(`[${new Date().toISOString()}] Transcription: ${message}`);
  };

  // Custom handler for transcripts that updates both parent and local state
  const handleTranscript = (transcript) => {
    logWithTime(`Handling new transcript: ${transcript.speaker} - "${transcript.text}"`);
    
    // Update local state
    setLocalTranscripts(prev => [...prev, transcript]);
    
    // Call the parent callback
    if (typeof onTranscriptReceived === 'function') {
      onTranscriptReceived(transcript);
    }
  };

  // Initialize AI transcription
  const initializeAiTranscription = async () => {
    try {
      logWithTime("Initializing AI transcription...");
      
      // Check if we already have an active connection
      if (aiAssemblyWsRef.current?.readyState === WebSocket.OPEN) {
        logWithTime("AI transcription already initialized");
        return;
      }
      
      // Validate remoteMediaStream
      if (!remoteMediaStream || !remoteMediaStream.active) {
        logWithTime("Remote media stream is not available or not active");
        return;
      }
      
      // Check if the stream has audio tracks
      const audioTracks = remoteMediaStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        logWithTime("Remote media stream has no audio tracks");
        return;
      }
      
      logWithTime(`Remote stream has ${audioTracks.length} audio tracks. First track enabled: ${audioTracks[0].enabled}`);
      
      // Get temporary token
      const jwtToken = localStorage.getItem("token");
      if (!jwtToken) {
        logWithTime("No JWT token found in localStorage");
        return;
      }
      
      const response = await fetch('https://demobackend-p2e1.onrender.com/transcription/assembly-token', {
        headers: { 
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get AI token: ${await response.text()}`);
      }
      
      const { token: aiTempToken } = await response.json();
      logWithTime("Got AI token: " + aiTempToken.substring(0, 10) + "...");
      
      const SAMPLE_RATE = 16000;
      const wsUrl = `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${SAMPLE_RATE}&token=${encodeURIComponent(aiTempToken)}`;
      
      logWithTime("Connecting to AssemblyAI WebSocket...");
      const aiWs = new WebSocket(wsUrl);
      aiAssemblyWsRef.current = aiWs;

      aiWs.onopen = () => {
        logWithTime("AI WebSocket connected");
        
        try {
          // Set up audio processing once WebSocket is open
          if (remoteMediaStream && remoteMediaStream.active) {
            // Close previous context if it exists
            if (aiAudioContextRef.current) {
              aiAudioContextRef.current.close().catch(err => logWithTime(`Error closing previous audio context: ${err.message}`));
            }
            
            aiAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
            
            // Create a media stream source from the remote stream
            const source = aiAudioContextRef.current.createMediaStreamSource(remoteMediaStream);
            
            // Create a script processor node
            const processor = aiAudioContextRef.current.createScriptProcessor(2048, 1, 1);
            aiProcessorRef.current = processor;
            
            // Set up the audio processing callback
            processor.onaudioprocess = (e) => {
              if (aiWs.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Data = convertFloat32ToInt16(inputData);
                aiWs.send(int16Data);
              }
            };
            
            // Connect the nodes: source -> processor -> destination
            source.connect(processor);
            processor.connect(aiAudioContextRef.current.destination);
            
            logWithTime("AI audio processing pipeline established");
            setAiTranscriptionInitialized(true);
          } else {
            logWithTime("Remote media stream not available for audio processing");
          }
        } catch (error) {
          logWithTime(`Error setting up AI audio processing: ${error.message}`);
          console.error("AI audio processing error:", error);
        }
      };

      aiWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.message_type === 'FinalTranscript') {
            logWithTime(`AI transcript received: "${message.text}"`);
            
            // Check if this is a duplicate or empty transcript
            if (message.text.trim() === '' || 
                (lastTranscriptRef.current.text === message.text && 
                 lastTranscriptRef.current.speaker === 'AI')) {
              logWithTime("Skipping empty or duplicate AI transcript");
              return;
            }
            
            // Update last transcript
            lastTranscriptRef.current = {
              text: message.text,
              speaker: 'AI',
              timestamp: new Date().toISOString()
            };

            // Handle the new transcript
            handleTranscript({
              text: message.text,
              speaker: 'AI',
              timestamp: new Date().toISOString()
            });
          } else if (message.message_type === 'PartialTranscript') {
            // Optionally log partial transcripts for debugging
            logWithTime(`AI partial transcript: "${message.text}"`);
          }
        } catch (error) {
          logWithTime(`Error processing AI message: ${error.message}`);
          console.error("AI message processing error:", error);
        }
      };

      aiWs.onerror = (error) => {
        logWithTime(`AI WebSocket error: ${error.message || 'Unknown error'}`);
        console.error("AI WebSocket error:", error);
      };

      aiWs.onclose = (event) => {
        logWithTime(`AI WebSocket closed: ${event.code} ${event.reason}`);
        setAiTranscriptionInitialized(false);
      };

    } catch (error) {
      logWithTime(`Failed to initialize AI transcription: ${error.message}`);
      console.error("AI transcription initialization error:", error);
    }
  };

  // Initialize user transcription
  const initializeUserTranscription = async () => {
    try {
      logWithTime("Initializing user transcription...");
      
      // Check if we already have an active connection
      if (userAssemblyWsRef.current?.readyState === WebSocket.OPEN) {
        logWithTime("User transcription already initialized");
        return;
      }
      
      // Validate localStream
      if (!localStream || !localStream.active) {
        logWithTime("Local stream is not available or not active");
        return;
      }
      
      // Check if the stream has audio tracks
      const audioTracks = localStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        logWithTime("Local stream has no audio tracks");
        return;
      }
      
      logWithTime(`Local stream has ${audioTracks.length} audio tracks. First track enabled: ${audioTracks[0].enabled}`);
      
      // Get temporary token
      const jwtToken = localStorage.getItem("token");
      if (!jwtToken) {
        logWithTime("No JWT token found in localStorage");
        return;
      }
      
      const response = await fetch('https://demobackend-p2e1.onrender.com/transcription/assembly-token', {
        headers: { 
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get user token: ${await response.text()}`);
      }
      
      const { token: userTempToken } = await response.json();
      logWithTime("Got user token: " + userTempToken.substring(0, 10) + "...");
      
      const SAMPLE_RATE = 16000;
      const wsUrl = `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${SAMPLE_RATE}&token=${encodeURIComponent(userTempToken)}`;
      
      logWithTime("Connecting to AssemblyAI WebSocket for user audio...");
      const userWs = new WebSocket(wsUrl);
      userAssemblyWsRef.current = userWs;

      userWs.onopen = () => {
        logWithTime("User WebSocket connected");
        
        try {
          // Set up audio processing once WebSocket is open
          if (localStream && localStream.active) {
            // Close previous context if it exists
            if (userAudioContextRef.current) {
              userAudioContextRef.current.close().catch(err => logWithTime(`Error closing previous user audio context: ${err.message}`));
            }
            
            userAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
            
            // Create a media stream source from the local stream
            const source = userAudioContextRef.current.createMediaStreamSource(localStream);
            
            // Create a script processor node
            const processor = userAudioContextRef.current.createScriptProcessor(2048, 1, 1);
            userProcessorRef.current = processor;
            
            // Set up the audio processing callback
            processor.onaudioprocess = (e) => {
              if (userWs.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Data = convertFloat32ToInt16(inputData);
                userWs.send(int16Data);
              }
            };
            
            // Connect the nodes: source -> processor -> destination
            source.connect(processor);
            processor.connect(userAudioContextRef.current.destination);
            
            logWithTime("User audio processing pipeline established");
            setUserTranscriptionInitialized(true);
          } else {
            logWithTime("Local stream not available for audio processing");
          }
        } catch (error) {
          logWithTime(`Error setting up user audio processing: ${error.message}`);
          console.error("User audio processing error:", error);
        }
      };

      userWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.message_type === 'FinalTranscript') {
            logWithTime(`User transcript received: "${message.text}"`);
            
            // Check if this is a duplicate or empty transcript
            if (message.text.trim() === '' || 
                (lastTranscriptRef.current.text === message.text && 
                 lastTranscriptRef.current.speaker === 'User')) {
              logWithTime("Skipping empty or duplicate user transcript");
              return;
            }
            
            // Update last transcript
            lastTranscriptRef.current = {
              text: message.text,
              speaker: 'User',
              timestamp: new Date().toISOString()
            };

            // Handle the new transcript
            handleTranscript({
              text: message.text,
              speaker: 'User',
              timestamp: new Date().toISOString()
            });
          } else if (message.message_type === 'PartialTranscript') {
            // Optionally log partial transcripts for debugging
            logWithTime(`User partial transcript: "${message.text}"`);
          }
        } catch (error) {
          logWithTime(`Error processing user message: ${error.message}`);
          console.error("User message processing error:", error);
        }
      };

      userWs.onerror = (error) => {
        logWithTime(`User WebSocket error: ${error.message || 'Unknown error'}`);
        console.error("User WebSocket error:", error);
      };

      userWs.onclose = (event) => {
        logWithTime(`User WebSocket closed: ${event.code} ${event.reason}`);
        setUserTranscriptionInitialized(false);
      };

    } catch (error) {
      logWithTime(`Failed to initialize user transcription: ${error.message}`);
      console.error("User transcription initialization error:", error);
    }
  };

  // Initialize transcription when streams are available and call is active
  useEffect(() => {
    logWithTime(`Transcription useEffect triggered - isCallActive: ${isCallActive}, remoteStream: ${!!remoteMediaStream}, localStream: ${!!localStream}`);
    
    if (isCallActive) {
      // Add a delay to ensure streams are fully established
      const initTimeout = setTimeout(() => {
        if (remoteMediaStream && remoteMediaStream.active) {
          logWithTime("Initializing AI transcription after delay");
          initializeAiTranscription();
        }
        
        if (localStream && localStream.active) {
          logWithTime("Initializing user transcription after delay");
          initializeUserTranscription();
        }
      }, 2000); // 2 second delay
      
      return () => {
        clearTimeout(initTimeout);
      };
    }
  }, [isCallActive, remoteMediaStream, localStream]);

  // Separate useEffect for cleanup to avoid dependency issues
  useEffect(() => {
    // Cleanup function
    return () => {
      logWithTime("Cleaning up transcription resources");
      
      // Clean up AI transcription resources
      if (aiAssemblyWsRef.current) {
        aiAssemblyWsRef.current.close();
        aiAssemblyWsRef.current = null;
      }
      
      if (aiProcessorRef.current) {
        try {
          aiProcessorRef.current.disconnect();
        } catch (error) {
          logWithTime(`Error disconnecting AI processor: ${error.message}`);
        }
        aiProcessorRef.current = null;
      }
      
      if (aiAudioContextRef.current) {
        try {
          aiAudioContextRef.current.close();
        } catch (error) {
          logWithTime(`Error closing AI audio context: ${error.message}`);
        }
        aiAudioContextRef.current = null;
      }
      
      // Clean up user transcription resources
      if (userAssemblyWsRef.current) {
        userAssemblyWsRef.current.close();
        userAssemblyWsRef.current = null;
      }
      
      if (userProcessorRef.current) {
        try {
          userProcessorRef.current.disconnect();
        } catch (error) {
          logWithTime(`Error disconnecting user processor: ${error.message}`);
        }
        userProcessorRef.current = null;
      }
      
      if (userAudioContextRef.current) {
        try {
          userAudioContextRef.current.close();
        } catch (error) {
          logWithTime(`Error closing user audio context: ${error.message}`);
        }
        userAudioContextRef.current = null;
      }
      
      setAiTranscriptionInitialized(false);
      setUserTranscriptionInitialized(false);
    };
  }, []);

  // Determine which transcripts to display (use local state as fallback)
  const displayTranscripts = transcripts && transcripts.length > 0 ? transcripts : localTranscripts;

  return (
    <div className={styles.transcriptPanel}>
      <div className={styles.transcriptHeader}>
        <span>Transcript:</span>
        <img src="/assets/chat.svg" alt="Transcript" width="20" height="20" />
      </div>
      <div className={styles.transcriptContent}>
        {displayTranscripts.length === 0 ? (
          <div className={styles.emptyState}>Transcripts will appear here...</div>
        ) : (
          displayTranscripts.map((transcript, index) => (
            <div key={index} className={styles.transcriptEntry}>
              <span className={styles.timestamp}>
                {new Date(transcript.timestamp).toLocaleTimeString([], { 
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit'
                })}:
              </span>
              <span className={`${styles.transcriptText} ${
                transcript.speaker === 'AI' ? styles.aiText : styles.userText
              }`}>
                "{transcript.text}"
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Transcription; 