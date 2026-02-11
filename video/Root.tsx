import { Composition, Folder } from "remotion";
import {
  PromoOrbit45,
  PROMO_DURATION_IN_FRAMES,
  type PromoOrbitProps,
} from "./compositions/PromoOrbit45";

export const RemotionRoot = () => {
  return (
    <Folder name="ZeeMe-Promo">
      <Composition
        id="PromoOrbit45"
        component={PromoOrbit45}
        durationInFrames={PROMO_DURATION_IN_FRAMES}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          userName: "Friend",
        } satisfies PromoOrbitProps}
      />
    </Folder>
  );
};
