import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { PixelMascot } from "@/features/mascots/PixelMascot";
import { PIXEL_MASCOT_NAMES } from "@/features/mascots/pixelMascots";
import { SettingsPage } from "@/features/settings/SettingsUI";
import { useUpdateMono } from "@/features/workspace/monoProfile";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors, useScheme } from "@/ui/theme";

/** The desktop's swatches for a Mono (COLORS_MONO). */
const SWATCHES = [
  "#459cf7", "#ea603e", "#f4bf25", "#39c363", "#e45a9f", "#b168d4", "#37beb4", "#ef8c39", "#8b63e9",
];

// A Mono's look: its name, then which mascot it is and in what colour, as the
// desktop's look editor. Each change saves on the desktop as it is made; the
// preview shows it straight away.
export default function EditMonoScreen() {
  const { monoId } = useLocalSearchParams<{ monoId: string }>();
  const mono = useWorkspace().monos.find((m) => m.id === monoId);
  const update = useUpdateMono(monoId);
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  // Shown at once; the desktop's copy catches up on its next catalog.
  const [name, setName] = useState(mono?.name ?? "");
  const [mascot, setMascot] = useState(mono?.mascot ?? "ghost");
  const [color, setColor] = useState(mono?.color ?? SWATCHES[0]);
  const saved = useRef(mono?.name ?? "");

  const save = (change: { name?: string; mascot?: string; color?: string }) =>
    update(change).catch((reason) =>
      Alert.alert("Couldn’t save", reason instanceof Error ? reason.message : String(reason)),
    );
  // The name saves once typing pauses, not on every key.
  useEffect(() => {
    const next = name.trim();
    if (next === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = next;
      void save({ name: next });
    }, 600);
    return () => clearTimeout(timer);
    // `save` is stable enough: it only closes over `update`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (!mono) return null;
  return (
    <SettingsPage>
      <View style={styles.preview}>
        <PixelMascot name={mascot} color={color} size={88} />
      </View>

      <Text style={styles.heading}>Name</Text>
      <View style={styles.card}>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={40}
          placeholder="Name"
          placeholderTextColor={colors.muted}
          keyboardAppearance={scheme}
          returnKeyType="done"
          style={styles.input}
        />
      </View>

      <Text style={styles.heading}>Mascot</Text>
      <View style={[styles.card, styles.grid]}>
        {PIXEL_MASCOT_NAMES.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="radio"
            accessibilityLabel={name}
            accessibilityState={{ selected: name === mascot }}
            onPress={() => {
              if (name === mascot) return;
              void Haptics.selectionAsync();
              setMascot(name);
              void save({ mascot: name });
            }}
            style={[styles.mascot, name === mascot && { borderColor: color }]}
          >
            <PixelMascot name={name} color={color} size={36} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.heading}>Color</Text>
      <View style={[styles.card, styles.swatches]}>
        {SWATCHES.map((swatch) => (
          <Pressable
            key={swatch}
            accessibilityRole="radio"
            accessibilityLabel={swatch}
            accessibilityState={{ selected: swatch === color.toLowerCase() }}
            hitSlop={4}
            onPress={() => {
              if (swatch === color.toLowerCase()) return;
              void Haptics.selectionAsync();
              setColor(swatch);
              void save({ color: swatch });
            }}
            style={[styles.ring, swatch === color.toLowerCase() && { borderColor: swatch }]}
          >
            <View style={[styles.dot, { backgroundColor: swatch }]}>
              {swatch === color.toLowerCase() ? <Icon name="check" size={14} color="#ffffff" /> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </SettingsPage>
  );
}

const useStyles = themedStyles((colors) => ({
  preview: {
    alignItems: "center",
    paddingVertical: 8,
  },
  heading: {
    color: colors.muted,
    fontSize: 15,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  input: {
    color: colors.content,
    fontSize: 17,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    rowGap: 10,
  },
  mascot: {
    width: "18%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: colors.background,
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    rowGap: 10,
  },
  ring: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
}));
