import type { ReactNode } from "react";
import decorSparkle from "../assets/decor-sparkle.svg";
import brandCoor from "../assets/brand-coor.svg";
import brandSparkle from "../assets/brand-sparkle.svg";
import brandUnderline from "../assets/brand-underline.svg";
import userIcon from "../assets/user-icon.svg";

const TOTAL_STEPS = 5;

// Full-viewport canvas (min 1280×800) shared by every screen: gradient, decorative sparkle, nav bar,
// and a content area that centers the screen's card below the nav.
export function Stage({ step, children }: { step: number | null; children?: ReactNode }) {
  return (
    <div className="stage">
      <div className="stage-bg" />
      <img
        className="decor decor-sparkle"
        src={decorSparkle}
        width={630}
        height={783}
        alt=""
        aria-hidden="true"
        data-testid="decor.sparkle"
      />
      <NavBar step={step} />
      <main className="content">{children}</main>
    </div>
  );
}

function NavBar({ step }: { step: number | null }) {
  return (
    <header className="nav">
      <div className="brand" role="img" aria-label="Matrix Coor">
        <span className="brand-matrix" aria-hidden="true">MATRIX</span>
        <img className="brand-underline" src={brandUnderline} width={116.1} height={1.5} alt="" />
        <img className="brand-coor" src={brandCoor} width={110.85} height={23.57} alt="" />
        <img className="brand-sparkle" src={brandSparkle} width={31.1} height={38.62} alt="" />
      </div>
      <div className="nav-right">
        {step !== null && <p className="nav-progress">Step {step} of {TOTAL_STEPS}</p>}
        {/* Decorative account avatar: not a control, so no testid and no focus/interaction. */}
        <div className="avatar" aria-hidden="true">
          <img src={userIcon} width={17.76} height={18.37} alt="" />
        </div>
      </div>
    </header>
  );
}
