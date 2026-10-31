import { router, Stack } from "expo-router";

import {
  HeaderButton,
  modalStackOptions,
  sheetScreenLayout,
} from "@/features/files/codeScreen";
import { androidBackHeader } from "@/ui/AndroidHeader";
import { useColors } from "@/ui/theme";

// A Mono's profile: a native modal with its own stack, as Settings, so editing
// its look pushes inside the sheet and the close button dismisses the lot.
export default function MonoProfileLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={modalStackOptions(colors)}
      screenLayout={sheetScreenLayout(colors.sheet)}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "",
          headerLeft: () => (
            <HeaderButton icon="close" label="Close" onPress={() => router.back()} />
          ),
        }}
      />
      <Stack.Screen name="edit" options={{ title: "Edit", ...androidBackHeader("Edit") }} />
    </Stack>
  );
}
