import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";

interface ScreenHeaderProps {
  titleText?: string;
  rightContent?: React.ReactNode;
  centerContent?: React.ReactNode;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  titleText,
  rightContent,
  centerContent,
  children,
}: ScreenHeaderProps) => {
  return (
    <AppScreenHeader titleText={titleText} withoutSearch rightContent={rightContent} centerContent={centerContent}>
      {children}
    </AppScreenHeader>
  );
};
