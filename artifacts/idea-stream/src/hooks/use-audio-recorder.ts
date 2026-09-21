import { useCallback, useEffect, useRef, useState } from "react";

const preferredMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(
      () =>
        setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
      500,
    );
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    setIsSupported(
      Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof window.MediaRecorder !== "undefined",
    );

    return () => {
      if (mediaRecorderRef.current?.state === "recording")
        mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setIsSupported(false);
      throw new Error("Audio recording is not supported");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = preferredMimeTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start(250);
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      throw new Error("No active recording");
    }

    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        reject(new Error("Recording failed"));
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        setIsRecording(false);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  return {
    isRecording,
    isSupported,
    elapsedSeconds,
    startRecording,
    stopRecording,
  };
}
