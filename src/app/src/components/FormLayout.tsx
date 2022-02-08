import React from "react";

import "./FormLayout.css";

export enum FormLayoutDirection {
  HORIZONTAL = "horizontal",
  VERTICAL = "vertical"
}

export interface FormLayoutProps {
  direction?: FormLayoutDirection;
  children?: React.ReactNode;
}
export const FormLayout: React.FC<FormLayoutProps> = ({ children, direction }) => {
  return (
    <div className="FormLayout" data-direction={direction || FormLayoutDirection.HORIZONTAL}>
      {children}
    </div>
  );
};
