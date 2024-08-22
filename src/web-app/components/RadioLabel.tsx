export interface RadioLabelProps {
  text: string;
  important?: boolean;
  highlight?: boolean;
}

export const RadioLabel: React.FC<RadioLabelProps> = ({ text, important, highlight }: RadioLabelProps) => {
  const flag = important ? "*" : "";
  return (
    <span className="RadioLabel">
      {highlight ? <strong>{text}</strong> : text} {flag}
    </span>
  );
};
