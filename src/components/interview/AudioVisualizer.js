import React, { useRef, useEffect } from 'react';

function AudioVisualizer({ mediaStream }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!mediaStream) {
      console.log('No media stream available');
      return;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    source.connect(analyser);
    
    // Configure for volume detection
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Create initial random lengths for bars
    const numLines = 100;
    const randomFactors = Array.from({ length: numLines }, () => Math.random() * 0.5 + 0.5);

    function draw() {
      analyser.getByteFrequencyData(dataArray);

      // Calculate average volume
      const volume = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
      
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;
      const centerX = WIDTH / 2;
      const centerY = HEIGHT / 2;
      const baseRadius = Math.min(WIDTH, HEIGHT) * 0.3;

      // Clear canvas
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      // Draw lines
      const angleStep = (2 * Math.PI) / numLines;
      const minLength = baseRadius * 0.15; // Minimum line length
      const maxLengthAdd = baseRadius * 0.5; // Maximum additional length

      ctx.strokeStyle = '#007BFF';
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';

      for (let i = 0; i < numLines; i++) {
        const angle = i * angleStep - Math.PI / 2;
        
        // Calculate line length using volume and random factor
        const volumeFactor = volume / 255;
        const lineLength = minLength + (maxLengthAdd * volumeFactor * randomFactors[i]);
        
        // Calculate start point (inner circle)
        const startX = centerX + baseRadius * Math.cos(angle);
        const startY = centerY + baseRadius * Math.sin(angle);
        
        // Calculate end point
        const endX = centerX + (baseRadius + lineLength) * Math.cos(angle);
        const endY = centerY + (baseRadius + lineLength) * Math.sin(angle);

        // Draw line
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Occasionally update random factors
        if (Math.random() < 0.02) { // 2% chance each frame
          randomFactors[i] = Math.random() * 0.5 + 0.5;
        }
      }

      requestAnimationFrame(draw);
    }

    const animation = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animation);
      source.disconnect();
      analyser.disconnect();
      audioContext.close();
    };
  }, [mediaStream]);

  return (
    <canvas 
      ref={canvasRef}
      width={400}
      height={400}
      style={{
        width: '100%',
        height: '100%',
        maxWidth: '400px',
        maxHeight: '400px',
        backgroundColor: 'white'
      }}
    />
  );
}

export default AudioVisualizer;
