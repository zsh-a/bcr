import type { RuntimeServices } from "@bcr/react";
import { createContext, useContext } from "react";

export const ServicesContext = createContext<RuntimeServices | null>(null);

export function useServices(): RuntimeServices {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error("useServices must be used within ServicesContext.Provider");
  }
  return services;
}
