interface RadioLabelProps {
  text: string;
  highlight?: boolean;
}

export const RadioLabel: React.FC<RadioLabelProps> = ({ text, highlight }) => {
  return <span className="RadioLabel">{highlight ? <strong>{text}</strong> : text}</span>;
};
