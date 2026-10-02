'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Scan, Upload, X } from 'lucide-react';
import type jsQRType from 'jsqr';
import css from './TreasureHunt.module.css';

type Fragment  = { discovered: boolean; displayValue: string };
type Word      = { isCompleted: boolean; fragments: Fragment[]; word?: string };
type HuntState = {
  progress: Word[];
  stats: {
    solvedChallenges: number;
    discoveredFragments: number;
    totalFragments: number;
    isHuntComplete: boolean;
  };
};
type Challenge = {
  id: string;
  observationPoint?: string;
  prompt: string;
  options?: string[];
};
type ScanState =
  | 'idle' | 'requesting' | 'active' | 'detected' | 'verified'
  | 'error-camera' | 'error-invalid';

/* Challenge Modal */
function ChallengeModal({
  challenge, onClose, onSuccess,
}: { challenge: Challenge; onClose: () => void; onSuccess: () => void }) {
  const [ans, setAns]        = useState('');
  const [err, setErr]        = useState(false);
  const [submitting, setSub] = useState(false);
  const isAck = !challenge.options || challenge.options.length === 0;

  const submit = async () => {
    setSub(true);
    try {
      const res  = await fetch(`/api/hunt/challenge/${challenge.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: isAck ? 'acknowledge' : ans }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.isDummy) alert(data.message);
        onSuccess();
      } else {
        setErr(true);
        setTimeout(() => setErr(false), 800);
      }
    } catch {
      setErr(true);
    } finally {
      setSub(false);
    }
  };

  return (
    <div className={css.overlay}>
      <div className={css.modal}>
        <button className={css.modalClose} onClick={onClose}><X size={14} /></button>
        <div>
          <div className={css.modalEyebrow}>OBSERVATION POINT</div>
          <h2 className={css.modalTitle}>{challenge.observationPoint || 'Quantum Measurement'}</h2>
        </div>
        <p className={css.modalPrompt}>{challenge.prompt}</p>
        {!isAck && (
          <div className={css.optionList}>
            {challenge.options!.map((opt, i) => (
              <label key={i} className={`${css.option} ${ans === opt ? css.optionSelected : ''}`}>
                <div className={css.optionRadio} />
                <input
                  type="radio" name="mcq" value={opt} checked={ans === opt}
                  onChange={e => setAns(e.target.value)} disabled={submitting}
                  style={{ display: 'none' }}
                />
                {opt}
              </label>
            ))}
          </div>
        )}
        {err && <p className={css.modalError}>Incorrect. Try again.</p>}
        <button className={css.submitBtn} onClick={submit} disabled={(!isAck && !ans) || submitting}>
          {submitting ? 'STABILISING...' : isAck ? 'ACKNOWLEDGE' : 'CONFIRM OBSERVATION'}
        </button>
      </div>
    </div>
  );
}

/* Inline Scanner */
function InlineScanner({ onScanSuccess, onClose }: { onScanSuccess: (t: string) => void; onClose: () => void }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef    = useRef<number>(0);
  const jsQRRef   = useRef<typeof jsQRType | null>(null);
  const lastRef   = useRef(0);
  const [state, setState] = useState<ScanState>('idle');
  const [code,  setCode]  = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  const handleData = useCallback((raw: string) => {
    let token = raw;
    try {
      const u = new URL(raw);
      if (u.searchParams.get('token')) token = u.searchParams.get('token')!;
    } catch { /* not a URL */ }
    setCode(token.substring(0, 8) + '...');
    setState('detected');
    stop();
    setTimeout(() => { setState('verified'); setTimeout(() => onScanSuccess(token), 600); }, 900);
  }, [onScanSuccess, stop]);

  const startLoop = useCallback(async () => {
    if (!jsQRRef.current) { const m = await import('jsqr'); jsQRRef.current = m.default; }
    const jsQR = jsQRRef.current;
    const MAXDIM = 480, INTERVAL = 120;
    const tick = (now: number) => {
      const v = videoRef.current, c = canvasRef.current;
      if (!v || !c || v.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
      if (now - lastRef.current < INTERVAL) { rafRef.current = requestAnimationFrame(tick); return; }
      lastRef.current = now;
      const scale = Math.min(1, MAXDIM / Math.max(v.videoWidth || 640, v.videoHeight || 480));
      c.width  = Math.round((v.videoWidth  || 640) * scale);
      c.height = Math.round((v.videoHeight || 480) * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (res) { handleData(res.data); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [handleData]);

  const startCamera = useCallback(async () => {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setState('active');
      await startLoop();
    } catch { setState('error-camera'); }
  }, [startLoop]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if ('mediaDevices' in navigator) startCamera(); else setState('error-camera'); }, []);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!jsQRRef.current) { const m = await import('jsqr'); jsQRRef.current = m.default; }
    const jsQR = jsQRRef.current;
    const img  = new Image();
    img.onload = () => {
      const c = canvasRef.current ?? document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const id  = ctx.getImageData(0, 0, c.width, c.height);
      const res = jsQR(id.data, id.width, id.height);
      URL.revokeObjectURL(img.src);
      if (res) { handleData(res.data); }
      else { setState('error-invalid'); setTimeout(() => setState(streamRef.current ? 'active' : 'idle'), 2200); }
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  }, [handleData]);

  const statusMap: Record<ScanState, string> = {
    idle:            'INITIALISING SCANNER...',
    requesting:      'REQUESTING CAMERA...',
    active:          'SEARCHING FOR QUANTUM SIGNAL...',
    detected:        'SIGNAL DETECTED',
    verified:        'OBSERVATION POINT VERIFIED',
    'error-camera':  'NO CAMERA — USE IMAGE UPLOAD',
    'error-invalid': 'SIGNAL UNRECOGNISED — RETRY',
  };
  const statusCls =
    state === 'active' || state === 'detected' || state === 'verified' ? css.scanStatusActive :
    state.startsWith('error') ? css.scanStatusError : '';

  return (
    <div className={css.scannerShell}>
      {/* Status bar */}
      <div className={`${css.scanStatus} ${statusCls}`}>{statusMap[state]}</div>

      {/* Viewport — fixed size, clips everything inside */}
      <div className={css.scannerViewport}>
        {/* Video: absolutely fills the viewport, never escapes */}
        <video
          ref={videoRef}
          className={css.scannerVideo}
          autoPlay muted playsInline
          style={{ display: state === 'active' ? 'block' : 'none' }}
          aria-hidden="true"
        />
        {(state === 'idle' || state === 'requesting' || state === 'error-camera') && (
          <div className={css.scannerIdle}>
            <div className={css.scannerIdleIcon} />
            <span className={css.scannerIdleLabel}>
              {state === 'error-camera' ? 'NO SIGNAL' : 'STANDBY'}
            </span>
          </div>
        )}
        {(state === 'detected' || state === 'verified') && (
          <div className={css.scannerDetected}>
            <div className={css.detectRing} />
            <div className={css.detectRing} />
            <p className={css.detectText}>{state === 'verified' ? 'VERIFIED' : 'DETECTED'}</p>
            {code && <p className={css.detectSub}>{code}</p>}
          </div>
        )}
        {state !== 'error-camera' && (
          <>
            <div className={`${css.bracket} tl`} />
            <div className={`${css.bracket} tr`} />
            <div className={`${css.bracket} bl`} />
            <div className={`${css.bracket} br`} />
            {state === 'active' && <div className={css.scanLine} />}
          </>
        )}
      </div>

      {/* Controls — always below the viewport, never overlapping */}
      <div className={css.scanCta}>
        <label className={css.uploadLabel} role="button" tabIndex={0}>
          <Upload size={13} /> UPLOAD QR IMAGE
          <input type="file" accept="image/*" style={{ display: 'none' }}
            onChange={handleFile} tabIndex={-1} />
        </label>
        <button className={css.scanClose} onClick={onClose}>
          <X size={12} /> CLOSE SCANNER
        </button>
        <p className={css.scanHint}>DESKTOP: SCREENSHOT THE QR CODE AND UPLOAD ABOVE</p>
      </div>

      <canvas ref={canvasRef} className={css.hiddenCanvas} aria-hidden="true" />
    </div>
  );
}

/* Word Card */
function WordCard({ word, index, delay }: { word: Word; index: number; delay: number }) {
  const labels = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA'];
  const label  = labels[index] ?? `WORD ${index + 1}`;
  const frags  = word.fragments || [];
  const found  = frags.filter(f => f.discovered).length;

  return (
    <div
      className={`${css.wordCard} ${word.isCompleted ? css.wordCardCompleted : ''}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <div className={css.wordIndex}>FRAGMENT — {label}</div>
      <div className={css.wordProgress}>{found}/{frags.length}</div>
      <div className={css.nodeRow}>
        {frags.map((frag, i) => {
          const nextFound = i < frags.length - 1 ? frags[i + 1].discovered : false;
          return (
            <React.Fragment key={i}>
              <div className={[
                css.node,
                frag.discovered && !word.isCompleted ? css.nodeDiscovered : '',
                frag.discovered &&  word.isCompleted ? css.nodeCompleted  : '',
              ].join(' ')}>
                {/* HIDDEN-LETTER BUG FIX: characters only render when word is fully complete */}
                {word.isCompleted ? (
                  <span className={css.nodeChar} style={{ animationDelay: `${i * 120}ms` }}>
                    {frag.displayValue}
                  </span>
                ) : (
                  <span className={css.nodePsi}>ψ</span>
                )}
              </div>
              {i < frags.length - 1 && (
                <div className={css.nodeConnector}>
                  <div className={[
                    css.nodeConnectorFill,
                    frag.discovered && nextFound && !word.isCompleted ? css.nodeConnectorActive   : '',
                    frag.discovered && nextFound &&  word.isCompleted ? css.nodeConnectorComplete : '',
                  ].join(' ')} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {word.isCompleted && word.word && (
        <div className={css.wordReveal}>{word.word.toUpperCase()}</div>
      )}
    </div>
  );
}

/* Page */
export default function TreasureHunt() {
  const [huntState,       setHuntState]       = useState<HuntState | null>(null);
  const [showScanner,     setShowScanner]     = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [showVictory,     setShowVictory]     = useState(false);
  const [loading,         setLoading]         = useState(true);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch('/api/hunt/progress');
      if (res.ok) {
        const data: HuntState = await res.json();
        setHuntState(data);
        if (data.stats.isHuntComplete) setShowVictory(true);
      } else if (res.status === 401) {
        const u = new URL(window.location.href);
        const t = u.searchParams.get('token');
        window.location.href = t ? `/login?token=${t}` : '/login';
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleScanSuccess = useCallback(async (token: string) => {
    setShowScanner(false);
    setLoading(true);
    try {
      const res  = await fetch('/api/hunt/qr/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.alreadySolved || data.type === 'DUMMY') alert(data.message);
        else setActiveChallenge(data as Challenge);
      } else {
        alert(data.error || 'Failed to resolve QR');
      }
    } catch {
      alert('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProgress();
    const u = new URL(window.location.href);
    const t = u.searchParams.get('token');
    if (t) { handleScanSuccess(t); window.history.replaceState({}, '', '/treasure'); }
  }, [fetchProgress, handleScanSuccess]);

  if (loading && !huntState) {
    return (
      <div className={css.loading}>
        <div className={css.loadingRing} />
        <span className={css.loadingLabel}>CALIBRATING QUANTUM FIELD...</span>
      </div>
    );
  }

  const total    = huntState?.stats.discoveredFragments ?? 0;
  const target   = huntState?.stats.totalFragments ?? 18;
  const pct      = target > 0 ? Math.round((total / target) * 100) : 0;
  const solved   = huntState?.stats.solvedChallenges ?? 0;
  const allWords = huntState?.progress ?? [];
  const half     = Math.ceil(allWords.length / 2);
  const leftCol  = allWords.slice(0, half);
  const rightCol = allWords.slice(half);
  const ticks    = Array.from({ length: 12 }, (_, i) => i * 30);

  return (
    <div className={css.page}>

      {/* Top Bar */}
      <div className={css.topBar}>
        <div className={css.topBarBrand}>
          <div className={css.topBarDot} />
          QUANTUM HUNT
        </div>
        <div className={css.topBarMeta}>
          FRAGMENTS {total}/{target} · OBSERVATIONS {solved}
        </div>
      </div>

      {/* Hero */}
      <section className={css.hero}>
        <div className={css.heroDecor} />
        <div className={css.heroEyebrow}>OBSERVATION PROTOCOL · ACTIVE</div>
        <h1 className={css.heroTitle}>
          <span className={css.heroTitleLine}>
            <span className={css.heroTitleWord}>QUANTUM</span>
          </span>
          <span className={css.heroTitleLine}>
            <span className={css.heroTitleWord}>HUNT<span className={css.heroPsi}>ψ</span></span>
          </span>
        </h1>
        <p className={css.heroSub}>
          Scan observation points · Collect quantum fragments · Unlock the final state
        </p>
      </section>

      {/* Progress */}
      <div className={css.progressBand}>
        <div className={css.progressLabel}>
          <span>QUANTUM COHERENCE</span>
          <span>{pct}%</span>
        </div>
        <div className={css.progressTrack}>
          <div className={css.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 3-column layout */}
      <div className={css.main}>

        {/* Left words */}
        <div className={css.fragmentCol}>
          {leftCol.map((w, i) => (
            <WordCard key={i} word={w} index={i} delay={0.4 + i * 0.08} />
          ))}
        </div>

        {/* Center: orbital scanner */}
        <div className={css.scannerCol}>

          {showScanner ? (
            /* ── Active scanner: no orbit, scanner shell is direct child ── */
            <InlineScanner onScanSuccess={handleScanSuccess} onClose={() => setShowScanner(false)} />
          ) : (
            /* ── Idle: decorative orbit + animated idle viewport ── */
            <div className={css.scannerOrbit}>
              <div className={`${css.orbitRing} ${css.orbitRingOuter}`} />
              <div className={`${css.orbitRing} ${css.orbitRingInner}`} />
              <div className={css.orbitRing} />
              {ticks.map(deg => (
                <div key={deg} className={css.orbitTick} style={{ transform: `rotate(${deg}deg)` }} />
              ))}
              <div className={css.scannerViewWrap}>
                <div className={css.scannerViewport}>
                  <div className={css.radarSweep} />
                  <div className={css.rippleRing} />
                  <div className={css.rippleRing} />
                  <div className={css.rippleRing} />
                  <div className={css.blip} />
                  <div className={css.scannerIdle}>
                    <div className={css.scannerIdleIcon} />
                    <span className={css.scannerIdleLabel}>STANDBY</span>
                  </div>
                  <div className={`${css.bracket} tl`} />
                  <div className={`${css.bracket} tr`} />
                  <div className={`${css.bracket} bl`} />
                  <div className={`${css.bracket} br`} />
                </div>
              </div>
            </div>
          )}

          {/* Initiate scan + desktop upload — only shown when idle */}
          {!showScanner && (
            <div className={css.scanCta}>
              <button className={css.scanBtn} onClick={() => setShowScanner(true)}>
                <Scan size={15} /> INITIATE SCAN
              </button>
              <label className={css.uploadLabel} role="button" tabIndex={0}>
                <Upload size={13} /> UPLOAD QR IMAGE
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const { default: jsQR } = await import('jsqr');
                    const img = new Image();
                    img.onload = () => {
                      const c = document.createElement('canvas');
                      c.width = img.width; c.height = img.height;
                      const ctx = c.getContext('2d')!;
                      ctx.drawImage(img, 0, 0);
                      const id  = ctx.getImageData(0, 0, c.width, c.height);
                      const res = jsQR(id.data, id.width, id.height);
                      URL.revokeObjectURL(img.src);
                      if (res) handleScanSuccess(res.data);
                      else alert('No QR code detected in that image.');
                    };
                    img.src = URL.createObjectURL(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <p className={css.scanHint}>DESKTOP: SCREENSHOT QR CODE · UPLOAD ABOVE</p>
            </div>
          )}
        </div>


        {/* Right words */}
        <div className={css.fragmentCol}>
          {rightCol.map((w, i) => (
            <WordCard key={i} word={w} index={half + i} delay={0.4 + (half + i) * 0.08} />
          ))}
        </div>

      </div>

      {/* Challenge Modal */}
      {activeChallenge && (
        <ChallengeModal
          challenge={activeChallenge}
          onClose={() => setActiveChallenge(null)}
          onSuccess={() => { setActiveChallenge(null); fetchProgress(); }}
        />
      )}

      {/* Victory */}
      {showVictory && (
        <div className={css.victory}>
          <div className={css.victoryPsi}>ψ</div>
          <h2 className={css.victoryTitle}>ALL STATES<br /><span>COLLAPSED</span></h2>
          <p className={css.victorySub}>Every quantum fragment has been stabilised.</p>
          <button className={css.victoryBtn} onClick={() => setShowVictory(false)}>
            RETURN TO FIELD
          </button>
        </div>
      )}
    </div>
  );
}
