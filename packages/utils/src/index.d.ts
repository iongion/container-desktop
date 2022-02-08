declare module "@podman-desktop-companion/utils" {
  import { AxiosRequestConfig } from "axios";
  export declare function axiosConfigToCURL(opts: AxiosRequestConfig): string;
}
