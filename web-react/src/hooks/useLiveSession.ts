// Mode "Séance en direct" : enchaîne les essais d'un drill, envoie les retours
// aux joueurs (téléphone + voix) et termine par le brief du drill.
// Reprend la logique de web/js/main.js (startLive / onRepEnded / endOfDrill)
// portée sur le store Zustand + lib/tts + lib/settings.
import { useCallback, useEffect, useRef } from "react";
import { useStore } from "@/store";
import type { LiveState } from "@/store";
import type { Drill, Rep } from "@/types";
import * as tts from "@/lib/tts";
import * as settings from "@/lib/settings";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const OFFENSE_WANT = ["QB", "WR", "TE", "RB", "OL"];
const DEFENSE_WANT = ["DL", "LB", "DB"];

export interface LiveSessionApi {
  isLive: boolean;
  start: () => void;
  stop: () => void;
}

export interface UseLiveSessionOptions {
  // Notifications visuelles (toasts), optionnelles.
  onToast?: (msg: string, kind?: "sent" | "info" | "bad") => void;
  // Fin de drill : ouvre l'aperçu du brief avant envoi. À défaut, envoi direct.
  onBriefPreview?: (args: {
    drill: Drill;
    playerId: string | null;
    onSend: (text: string) => void;
    onCancel: () => void;
  }) => void;
}

export function useLiveSession(opts: UseLiveSessionOptions = {}): LiveSessionApi {
  const live = useStore((s) => s.live);
  const setLive = useStore((s) => s.setLive);

  // Options stables dans un ref pour éviter de recréer les callbacks.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Jeton d'exécution : invalide les séquences async d'une session arrêtée.
  const tokenRef = useRef<LiveState | null>(null);

  // --- choix du joueur suivi pour un essai donné -------------------------
  const trackedPlayer = useCallback((rep: Rep): string | null => {
    const st = useStore.getState();
    const s = settings.get();
    const ids = Object.keys(rep.players || {});
    if (s.tracked === "selected" && st.selected && rep.players?.[st.selected]) {
      return st.selected;
    }
    const cur = st.live?.trackedId;
    if (cur && rep.players?.[cur]) return cur;
    const groupOf = (id: string) => st.session?.players[id]?.group;
    const want = rep.side === "offense" ? OFFENSE_WANT : DEFENSE_WANT;
    for (const g of want) {
      const id = ids.find((i) => groupOf(i) === g);
      if (id) return id;
    }
    return ids[0] || null;
  }, []);

  // --- arrêt --------------------------------------------------------------
  const stop = useCallback(() => {
    if (!useStore.getState().live) return;
    tokenRef.current = null;
    tts.stop();
    setLive(null);
  }, [setLive]);

  // --- démarrage ----------------------------------------------------------
  const start = useCallback(() => {
    const st = useStore.getState();
    if (!st.rep || !st.session) return;
    let drill = st.drillsById[st.rep.drillId];
    if (!drill) return;

    // Pour la démo, préférer un drill d'au moins 3 essais.
    if (drill.repIds.length < 3) {
      const ds = st.session.drills;
      const from = ds.indexOf(drill);
      const better = ds.slice(from).concat(ds.slice(0, from)).find((d) => d.repIds.length >= 3);
      if (better) drill = better;
    }

    st.setView("seance");

    // Repartir du début si l'essai courant est le dernier du drill.
    let idx = drill.repIds.indexOf(st.rep.id);
    if (drill.id !== st.rep.drillId) idx = 0;
    if (idx < 0 || idx === drill.repIds.length - 1) idx = 0;

    const firstRep = st.repsById[String(drill.repIds[idx])];
    const trackedId = firstRep ? trackedPlayer(firstRep) : null;

    const next: LiveState = { drillId: drill.id, idx, trackedId };
    tokenRef.current = next;
    setLive(next);
    st.setSpeed(1);
    st.openRep(String(drill.repIds[idx]), { autoplay: true });
    if (trackedId) st.select(trackedId);
    optsRef.current.onToast?.(
      `Séance en direct · ${drill.name} · retours envoyés à chaque fin d'essai`,
      "info"
    );
  }, [setLive, trackedPlayer]);

  // --- fin de drill -------------------------------------------------------
  const endOfDrill = useCallback(
    (token: LiveState, drill: Drill) => {
      const st = useStore.getState();
      if (!settings.wantsBrief()) {
        optsRef.current.onToast?.(`Drill terminé · ${drill.name}`, "info");
        stop();
        return;
      }
      const brief = drill.brief as
        | { players?: Record<string, { text?: string; points?: { text: string }[] }> }
        | undefined;
      const briefPlayers = brief?.players || {};
      const pid =
        token.trackedId && briefPlayers[token.trackedId]
          ? token.trackedId
          : Object.keys(briefPlayers)[0] || null;
      const pbp = pid ? briefPlayers[pid] : null;
      const defaultText = pbp?.text || (pbp?.points || []).map((p) => p.text).join(" ") || "";

      const send = async (text: string) => {
        if (tokenRef.current !== token) return;
        const n = Object.keys(briefPlayers).length;
        const m = pid ? st.session?.players[pid] : null;
        optsRef.current.onToast?.(
          `Briefs envoyés · ${n} joueur${n > 1 ? "s" : ""} · ${drill.name}`,
          "sent"
        );
        useStore.getState().pushPhone({
          to: m ? `#${m.jersey} ${m.name}` : "Équipe",
          kind: "brief",
          text,
        });
        if (pid) useStore.getState().select(pid);
        await tts.speak(text, { id: "live-brief" });
        if (tokenRef.current === token) {
          stop();
          optsRef.current.onToast?.(
            "Drill terminé. Choisis un autre essai ou relance le direct.",
            "info"
          );
        }
      };

      if (optsRef.current.onBriefPreview) {
        optsRef.current.onBriefPreview({
          drill,
          playerId: pid,
          onSend: send,
          onCancel: () => {
            optsRef.current.onToast?.("Envoi des briefs annulé.", "info");
            stop();
          },
        });
      } else {
        void send(defaultText);
      }
    },
    [stop]
  );

  // --- fin d'un essai (appelé par la boucle de lecture) -------------------
  const onRepEnded = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    const st = useStore.getState();
    const rep = st.rep;
    if (!rep) return;
    const drill = st.drillsById[token.drillId];
    if (!drill) return;

    const pid = trackedPlayer(rep);
    if (pid) token.trackedId = pid;
    const pr = pid ? rep.players[pid] : null;
    const m = pid ? st.session?.players[pid] : null;

    const level = settings.get().level;
    if (level !== "silent") {
      if (settings.wantsRep()) {
        if (pr?.feedback && m) {
          const n = Object.values(rep.players || {}).filter((p) => p.feedback).length;
          optsRef.current.onToast?.(
            `Retour envoyé · ${n} joueur${n > 1 ? "s" : ""} · essai ${token.idx + 1}`,
            "sent"
          );
          useStore.getState().pushPhone({
            to: `#${m.jersey} ${m.name}`,
            kind: "rep",
            text: pr.feedback,
          });
          await tts.speak(pr.feedback, { id: "live" });
        } else {
          await wait(1500);
        }
      } else {
        await wait(1200);
      }
    } else {
      await wait(1000);
    }
    if (tokenRef.current !== token) return;
    await wait(700);
    if (tokenRef.current !== token) return;

    if (token.idx < drill.repIds.length - 1) {
      token.idx += 1;
      setLive({ ...token });
      const s2 = useStore.getState();
      s2.openRep(String(drill.repIds[token.idx]), { autoplay: true });
      const nextRep = useStore.getState().rep;
      if (token.trackedId && nextRep?.players?.[token.trackedId]) {
        useStore.getState().select(token.trackedId);
      }
    } else {
      endOfDrill(token, drill);
    }
  }, [trackedPlayer, setLive, endOfDrill]);

  // Garder la ref de onRepEnded à jour pour la boucle.
  const endedRef = useRef(onRepEnded);
  endedRef.current = onRepEnded;

  // Branche la fin d'essai sur la transition playing -> stopped en fin d'essai.
  useEffect(() => {
    let prevFrame = useStore.getState().frame;
    let prevPlaying = useStore.getState().playing;
    const unsub = useStore.subscribe((s) => {
      const rep = s.rep;
      // Détecte l'arrêt en fin d'essai pendant une session live.
      if (
        tokenRef.current &&
        rep &&
        prevPlaying &&
        !s.playing &&
        s.frame >= rep.nFrames - 1.001 &&
        prevFrame < rep.nFrames - 1.001
      ) {
        endedRef.current();
      }
      prevFrame = s.frame;
      prevPlaying = s.playing;
    });
    return unsub;
  }, []);

  // Nettoyage au démontage.
  useEffect(() => () => {
    tokenRef.current = null;
    tts.stop();
  }, []);

  return { isLive: live != null, start, stop };
}
