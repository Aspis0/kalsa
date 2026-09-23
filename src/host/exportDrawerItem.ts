import type { DrawerItem } from "../theme/components/Drawer";

export function createExportDrawerItem(
  label: string,
  Icon: DrawerItem["Icon"],
  onPress: () => void,
): DrawerItem {
  return { id: "export", label, Icon, onPress };
}
