import { Redirect, router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { ConnectionNotice } from "@/features/connection/ConnectionNotice";
import { hasNativeTranscript } from "@/features/connection/nativeLink";

import { PixelMascot } from "@/features/mascots/PixelMascot";
import { effortLabel } from "@/features/models/modelChoice";
import { useSessionChoice } from "@/features/models/sessionChoice";
import { useModelCatalog } from "@/features/models/useModelCatalog";
import { useDrawerSwipe } from "@/ui/ScenePager";
import { useConnection } from "@/features/connection/ConnectionProvider";
import { rememberPlace } from "@/features/workspace/lastPlace";
import { markMonoSeen } from "@/features/workspace/monoSeen";
import { Composer } from "@/features/sessions/Composer";
import { QuestionCard } from "@/features/sessions/QuestionCard";
import { EmptySession } from "@/features/sessions/EmptySession";
import { SessionScreen } from "@/features/sessions/SessionScreen";
import { Transcript } from "@/features/sessions/Transcript";
import { NativeTranscript } from "@/features/sessions/NativeTranscript";
import type { TranscriptAgent } from "@/features/sessions/TranscriptTurn";
import {
  monoConversationId,
  useConversation,
  useConversationTurns,
  useWorkspace,
} from "@/features/workspace/WorkspaceProvider";

// A mono has one long-lived conversation, so its screen is that conversation.
export default function MonoScreen() {
  const { monoId } = useLocalSearchParams<{ monoId: string }>();
  const { monos, sendMessage, stop } = useWorkspace();
  useDrawerSwipe();
  const mono = monos.find((m) => m.id === monoId);
  const conversationId = mono ? monoConversationId(mono.id) : null;
  const conversation = useConversation(conversationId);
  // Where the app opens next time.
  const desktop = useConnection().pairing?.desktop.fingerprint;
  const placeId = mono?.id;
  useEffect(() => {
    if (placeId) rememberPlace(desktop, { kind: "mono", id: placeId });
  }, [desktop, placeId]);
  // Its replies are seen as they arrive while its chat is in front.
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && mono) markMonoSeen(desktop, mono);
  }, [focused, desktop, mono]);
  // Stable, so the memoized turns keep their rows across polls.
  const name = mono?.name ?? "";
  const mascot = mono?.mascot ?? "";
  const color = mono?.color ?? "";
  const agent = useMemo(() => ({ name, mascot, color }), [name, mascot, color]);
  // The model it runs with, named as a session's: a pick made here, else what
  // the desktop says the conversation runs with.
  const { catalog } = useModelCatalog(conversationId ?? undefined, conversationId ?? undefined);
  const { chosen } = useSessionChoice(undefined, conversationId ?? undefined);
  const current = chosen?.pick ?? catalog?.current;
  const entry = catalog?.models.find((model) => model.id === current?.model);
  const model = chosen?.name ?? entry?.name ?? current?.model ?? mono?.model ?? "";
  const harness = current?.harness ?? mono?.harness;
  const effort = current ? effortLabel(entry, current) : undefined;
  if (!mono || !conversationId) return <Redirect href="/" />;

  return (
    <SessionScreen
      pill={{
        icon: <PixelMascot name={mono.mascot} color={mono.color} status={mono.status} size={28} />,
        label: mono.name,
      }}
      // Settings on the right, as on a project.
      action={{ icon: "settings", label: "Settings", onPress: () => router.push("/settings") }}
      composer={
        <>
          {conversation.question ? (
            <QuestionCard conversationId={conversationId} prompt={conversation.question} />
          ) : null}
          <Composer
            key={mono.id}
            // The header names the Mono already, and it has no branch.
            context=""
            branch=""
            model={model}
            effort={effort}
            harness={harness}
            onModelPress={() =>
              router.push({
                pathname: "/models",
                params: { projectId: "", sessionId: conversationId },
              })
            }
            busy={conversation.busy}
            onStop={() => stop(conversationId)}
            onSend={(text, attachments) => sendMessage(conversationId, text, attachments)}
          />
        </>
      }
    >
      <ConnectionNotice error={conversation.error} />
      {hasNativeTranscript
        ? <NativeTranscript key={mono.id} conversationId={conversationId} agent={agent} />
        : <MonoTranscript key={mono.id} conversationId={conversationId} agent={agent} />}
    </SessionScreen>
  );
}

/** The mono's turns, read here so a streaming reply re-renders only the transcript. */
function MonoTranscript({
  conversationId,
  agent,
}: {
  conversationId: string;
  agent: TranscriptAgent;
}) {
  const { turns, hasOlder, loadOlder } = useConversationTurns(conversationId);
  return turns.length > 0 ? (
    <Transcript turns={turns} agent={agent} hasOlder={hasOlder} loadOlder={loadOlder} />
  ) : (
    <EmptySession />
  );
}
