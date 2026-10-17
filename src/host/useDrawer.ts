/**
 * The v2 drawer's open state, and the menu press that opens it. The keyboard
 * leaves before the menu opens: the composer's field would otherwise keep the
 * focus across the drawer, and iOS keeps the keyboard up with it.
 */
import { useCallback, useState } from "react";
import { Keyboard } from "react-native";

export function useDrawer() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openMenu = useCallback(() => {
    Keyboard.dismiss();
    setDrawerOpen(true);
  }, []);
  return { drawerOpen, setDrawerOpen, openMenu };
}
