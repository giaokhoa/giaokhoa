import { createContext, useContext } from 'react';

export const SidebarDefaultOpenContext = createContext<boolean>(true);

export function useSidebarDefaultOpen(): boolean {
  return useContext(SidebarDefaultOpenContext);
}
