// pi appends its truncation and limit warnings to a tool's result text ("[500 entries limit reached…]").
// `piCardResult` lifts them out of the payload so they cannot be parsed as a directory entry or a file's last
// line; this renders one as what it is — a note about the result, not part of it.
import { Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";

export const CardNotice: React.FC<{ notice?: string }> = ({ notice }) =>
  notice ? (
    <div className="AICardNotice">
      <Icon icon={IconNames.INFO_SIGN} size={12} />
      <span>{notice}</span>
    </div>
  ) : null;
