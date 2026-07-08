import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";

interface ScreenHeaderProps {
  searchTerm?: string;
  onSearch?: React.ChangeEventHandler<HTMLInputElement>;
  titleText?: string;
  rightContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  searchTerm,
  onSearch,
  titleText,
  rightContent,
  centerContent,
  children,
}: ScreenHeaderProps) => {
  return (
    <AppScreenHeader
      searchTerm={searchTerm}
      onSearch={onSearch}
      titleText={titleText}
      withoutSearch={!onSearch}
      rightContent={rightContent}
      centerContent={centerContent}
    >
      {children}
    </AppScreenHeader>
  );
};
