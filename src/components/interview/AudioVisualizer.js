import React, { useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

function AudioVisualizer({ mediaStream, isLoading }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const logoRef = useRef(null);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 400, height: 400 });
  const [logoLoaded, setLogoLoaded] = useState(false);
  const animationFrameRef = useRef(null);
  const peakTimersRef = useRef([]);
  const lastVolumeRef = useRef(0);
  const isSpeakingRef = useRef(false);
  
  // Add refs to store current and target values for smooth transitions
  const currentLengthsRef = useRef([]);
  const targetLengthsRef = useRef([]);

  // Load logo image
  useEffect(() => {
    const logo = new Image();
    logo.src = '/logo.svg';
    logo.onload = () => {
      logoRef.current = logo;
      setLogoLoaded(true);
    };
    logo.onerror = (err) => {
      console.error('Error loading logo:', err);
    };
  }, []);

  // Resize handler to maintain square aspect ratio
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const size = Math.min(containerWidth, 400); // Cap at 400px
        setCanvasDimensions({ width: size, height: size });
      }
    };

    // Initial sizing
    handleResize();
    
    // Add resize listener
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Check if mediaStream exists and has audio tracks
    if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
      console.log('No audio tracks available yet');
      setHasAudioTrack(false);
      return;
    }

    setHasAudioTrack(true);
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    source.connect(analyser);
    
    // Configure for volume detection
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8; // Increased for smoother transitions
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Create initial random lengths for bars
    const numLines = 100;
    const randomFactors = Array.from({ length: numLines }, () => Math.random() * 0.5 + 0.5);
    
    // Initialize current and target lengths
    if (currentLengthsRef.current.length === 0) {
      currentLengthsRef.current = Array(numLines).fill(0);
    }
    if (targetLengthsRef.current.length === 0) {
      targetLengthsRef.current = Array(numLines).fill(0);
    }
    
    // Create array to track peaks
    const peakFactors = Array(numLines).fill(0);
    
    // Setup random peak generation with smoother transitions
    const setupPeakTimers = () => {
      // Clear any existing timers
      peakTimersRef.current.forEach(timer => clearTimeout(timer));
      peakTimersRef.current = [];
      
      // Function to create a random peak
      const createRandomPeak = () => {
        // Only create peaks if speaking is detected
        if (!isSpeakingRef.current) {
          // Schedule next check if not speaking
          const nextCheckTime = 200; // Check again in 200ms
          const timer = setTimeout(createRandomPeak, nextCheckTime);
          peakTimersRef.current.push(timer);
          return;
        }
        
        // Choose a random section (group of adjacent lines)
        const sectionStart = Math.floor(Math.random() * numLines);
        const sectionWidth = Math.floor(Math.random() * 10) + 5; // 5-15 lines
        
        // Create a bell curve distribution for the peak intensity
        const peakCenter = sectionWidth / 2;
        const peakIntensity = Math.random() * 0.8 + 0.2; // 0.2-1.0 max intensity
        
        // Create a peak that affects multiple adjacent lines with bell curve distribution
        for (let i = 0; i < sectionWidth; i++) {
          const index = (sectionStart + i) % numLines;
          
          // Calculate intensity based on distance from center (bell curve)
          const distanceFromCenter = Math.abs(i - peakCenter);
          const normalizedDistance = distanceFromCenter / peakCenter;
          const intensity = peakIntensity * Math.exp(-3 * normalizedDistance * normalizedDistance);
          
          peakFactors[index] = intensity;
          
          // Schedule the peak to decay gradually
          const decayTime = Math.random() * 1500 + 800; // 800-2300ms
          const decaySteps = 20; // More steps for smoother decay
          const decayInterval = decayTime / decaySteps;
          const decayAmount = intensity / decaySteps;
          
          // Create multiple timers for gradual decay
          for (let step = 1; step <= decaySteps; step++) {
            const timer = setTimeout(() => {
              peakFactors[index] = Math.max(0, intensity - (decayAmount * step));
            }, decayInterval * step);
            
            peakTimersRef.current.push(timer);
          }
        }
        
        // Schedule next peak
        const nextPeakTime = Math.random() * 2000 + 500; // 500-2500ms
        const timer = setTimeout(createRandomPeak, nextPeakTime);
        peakTimersRef.current.push(timer);
      };
      
      // Start the peak generation
      createRandomPeak();
    };
    
    setupPeakTimers();

    function draw() {
      analyser.getByteFrequencyData(dataArray);

      // Calculate average volume
      const volume = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
      
      // Smooth volume transitions
      lastVolumeRef.current = lastVolumeRef.current * 0.7 + volume * 0.3;
      
      // Detect if speaking (volume above threshold)
      const speakingThreshold = 20; // Adjust based on your audio input sensitivity
      isSpeakingRef.current = lastVolumeRef.current > speakingThreshold;
      
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;
      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;
      const baseRadius = Math.min(WIDTH, HEIGHT) * 0.3;

      // Clear canvas
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      // Draw logo in the center if loaded
      if (logoLoaded && logoRef.current) {
        const logoSize = baseRadius * 1.5;
        ctx.drawImage(
          logoRef.current, 
          centerX - logoSize/2, 
          centerY - logoSize/2, 
          logoSize, 
          logoSize
        );
      }

      // Draw lines
      const angleStep = (2 * Math.PI) / numLines;
      const minLength = baseRadius * 0.15; // Minimum line length
      const maxLengthAdd = baseRadius * 0.5; // Maximum additional length
      
      // Intensity boost during speech
      const intensityBoost = isSpeakingRef.current ? 1.2 : 1.0; // 20% boost when speaking

      // Update target lengths based on current audio and peaks
      for (let i = 0; i < numLines; i++) {
        const volumeFactor = lastVolumeRef.current / 255;
        const peakBoost = peakFactors[i] * 0.5; // Peak boost (0-0.5)
        targetLengthsRef.current[i] = minLength + (maxLengthAdd * (volumeFactor * randomFactors[i] + peakBoost) * intensityBoost);
      }
      
      // Smooth transition between current and target lengths
      const transitionSpeed = 0.15; // Adjust for faster/slower transitions
      
      for (let i = 0; i < numLines; i++) {
        // Smoothly interpolate between current and target length
        currentLengthsRef.current[i] += (targetLengthsRef.current[i] - currentLengthsRef.current[i]) * transitionSpeed;
        
        const angle = i * angleStep - Math.PI / 2;
        const lineLength = currentLengthsRef.current[i];
        
        // Calculate start point (inner circle)
        const startX = centerX + baseRadius * Math.cos(angle);
        const startY = centerY + baseRadius * Math.sin(angle);
        
        // Calculate end point
        const endX = centerX + (baseRadius + lineLength) * Math.cos(angle);
        const endY = centerY + (baseRadius + lineLength) * Math.sin(angle);

        // Draw line with gradient
        const lineGradient = ctx.createLinearGradient(startX, startY, endX, endY);
        lineGradient.addColorStop(0, '#60A5FA'); // Lighter blue at start
        lineGradient.addColorStop(1, '#3B82F6'); // Darker blue at end
        
        ctx.strokeStyle = lineGradient;
        // Slightly thicker lines during speech
        ctx.lineWidth = isSpeakingRef.current ? 2.5 : 2;
        ctx.lineCap = 'round'; // Rounded line caps for smoother appearance
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Occasionally update random factors (less frequently for smoother changes)
        if (Math.random() < 0.005) { // 0.5% chance each frame
          randomFactors[i] = Math.random() * 0.5 + 0.5;
        }
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    }

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Clear all peak timers
      peakTimersRef.current.forEach(timer => clearTimeout(timer));
      peakTimersRef.current = [];
      
      source.disconnect();
      analyser.disconnect();
      audioContext.close();
    };
  }, [mediaStream, hasAudioTrack, logoLoaded]);

  // Update the drawLoadingState function
  const drawLoadingState = (ctx, WIDTH, HEIGHT, centerX, centerY, baseRadius) => {
    const numLines = 100;
    const angleStep = (2 * Math.PI) / numLines;
    const time = Date.now() / 1000;
    const rotationSpeed = 2;
    
    for (let i = 0; i < numLines; i++) {
      const angle = i * angleStep - Math.PI / 2;
      
      // Create multiple overlapping waves for smoother effect
      const wave1 = Math.cos(angle - time * rotationSpeed);
      const wave2 = Math.cos(angle - time * rotationSpeed + Math.PI * 0.5);
      const wave3 = Math.cos(angle - time * rotationSpeed + Math.PI);
      
      // Combine waves and normalize to 0-1 range
      const combinedWave = (wave1 + wave2 + wave3 + 3) / 6;
      
      // Ensure minimum height of 40% and max height of 100%
      const minHeightPercent = 0.4;
      const heightPercent = minHeightPercent + ((1 - minHeightPercent) * combinedWave);
      
      // Calculate line length with minimum height
      const maxLength = baseRadius * 0.5;
      const lineLength = maxLength * heightPercent;
      
      // Calculate start and end points
      const startX = centerX + baseRadius * Math.cos(angle);
      const startY = centerY + baseRadius * Math.sin(angle);
      const endX = centerX + (baseRadius + lineLength) * Math.cos(angle);
      const endY = centerY + (baseRadius + lineLength) * Math.sin(angle);

      // Draw line with gradient
      const lineGradient = ctx.createLinearGradient(startX, startY, endX, endY);
      lineGradient.addColorStop(0, '#60A5FA');
      lineGradient.addColorStop(1, '#3B82F6');
      
      ctx.strokeStyle = lineGradient;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  };

  // Modify the static visualization effect
  useEffect(() => {
    if (!hasAudioTrack && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;
      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;
      const baseRadius = Math.min(WIDTH, HEIGHT) * 0.3;

      function drawStatic() {
        // Clear canvas
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        
        // Draw logo in the center if loaded
        if (logoLoaded && logoRef.current) {
          const logoSize = baseRadius * 1.5;
          ctx.drawImage(
            logoRef.current, 
            centerX - logoSize/2, 
            centerY - logoSize/2, 
            logoSize, 
            logoSize
          );
        }

        if (isLoading) {
          // Draw loading animation
          drawLoadingState(ctx, WIDTH, HEIGHT, centerX, centerY, baseRadius);
        } else {
          // Draw normal static visualization
          // ... existing static visualization code ...
        }
        
        animationFrameRef.current = requestAnimationFrame(drawStatic);
      }
      
      animationFrameRef.current = requestAnimationFrame(drawStatic);
      
      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        // ... rest of cleanup code ...
      };
    }
  }, [hasAudioTrack, canvasDimensions, logoLoaded, isLoading]);

  return (
    <div 
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        aspectRatio: '1/1',
        maxWidth: '400px',
        maxHeight: '400px',
      }}
    >
      <canvas 
        ref={canvasRef}
        width={canvasDimensions.width}
        height={canvasDimensions.height}
        style={{
          width: `${canvasDimensions.width}px`,
          height: `${canvasDimensions.height}px`,
          backgroundColor: 'transparent'
        }}
      />
    </div>
  );
}

AudioVisualizer.propTypes = {
  mediaStream: PropTypes.object,
  isLoading: PropTypes.bool
};

export default AudioVisualizer;
