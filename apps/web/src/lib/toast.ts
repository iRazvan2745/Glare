import { sileo, type SileoOptions } from "sileo";

const DEFAULT_FILL = "#171717";

type ToastInput = string | SileoOptions;

function normalize(input: ToastInput): SileoOptions {
  if (typeof input === "string") {
    return { title: input, fill: DEFAULT_FILL };
  }

  return {
    fill: DEFAULT_FILL,
    ...input,
  };
}

export const toast = {
  success: (input: ToastInput) => sileo.success(normalize(input)),
  error: (input: ToastInput) => sileo.error(normalize(input)),
  warning: (input: ToastInput) => sileo.warning(normalize(input)),
  info: (input: ToastInput) => sileo.info(normalize(input)),
  loading: (input: ToastInput) => sileo.show(normalize(input)),
  dismiss: sileo.dismiss,
  clear: sileo.clear,
};
