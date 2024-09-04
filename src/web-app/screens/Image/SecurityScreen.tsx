import { AnchorButton, Divider, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { ContainerImage, SecurityReport, SecurityReportResultGroup, SecurityVulnerability } from "@/env/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { Application } from "@/container-client/Application";
import { ScreenHeader } from ".";
import "./SecurityScreen.css";

export const ID = "image.security";
export const Title = "Image Security";

export interface ScreenProps extends AppScreenProps {}

interface AppScreenState {
  pending: boolean;
  scanning: boolean;
  image?: ContainerImage;
  report?: SecurityReport;
}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();

  const [state, setState] = useState<AppScreenState>({
    pending: true,
    scanning: false,
    image: undefined
  });

  const { pending, scanning, image, report } = state;

  const { id } = useParams<{ id: string }>();
  const imageFetch = useStoreActions((actions) => actions.image.imageFetch);

  useEffect(() => {
    (async () => {
      try {
        const image = await imageFetch({
          Id: decodeURIComponent(id as any)
        });
        setState((prev) => ({ ...prev, pending: false, scanning: true, image, report: undefined }));
        try {
          // check security
          const instance = Application.getInstance();
          const report = await instance.checkSecurity({
            scanner: "trivy",
            subject: "image",
            target: image.FullName
          });
          console.debug(">> report", report);
          setState((prev) => ({ ...prev, pending: false, image, scanning: false, report })); // go to scanning
        } catch (error: any) {
          console.error("Unable to fetch at this moment", error);
          setState((prev) => ({ ...prev, scanning: false }));
        }
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
        setState((prev) => ({ ...prev, pending: false, scanning: false }));
      }
    })();
  }, [imageFetch, id]);

  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  let count = 0;

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        {scanning ? (
          <ScreenLoader screen={ID} pending={pending || scanning} description={t("Scanning for vulnerabilities")} />
        ) : (
          <>
            <div className="SecurityDetails">
              <HTMLTable compact striped data-table="image.scanning.report.counts">
                <tbody>
                  <tr>
                    <td>{t("Critical")}</td>
                    <td>
                      <span className="Severity" data-severity="CRITICAL">
                        {report?.counts.CRITICAL}
                      </span>
                    </td>
                    <td>{t("Low")}</td>
                    <td>
                      <span className="Severity" data-severity="LOW">
                        {report?.counts.LOW}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>{t("High")}</td>
                    <td>
                      <span className="Severity" data-severity="HIGH">
                        {report?.counts.HIGH}
                      </span>
                    </td>
                    <td></td>
                    <td></td>
                  </tr>
                  <tr>
                    <td>{t("Medium")}</td>
                    <td>
                      <span className="Severity" data-severity="MEDIUM">
                        {report?.counts.MEDIUM}
                      </span>
                    </td>
                    <td></td>
                    <td></td>
                  </tr>
                </tbody>
              </HTMLTable>
              <div className="HeaderSeparator"></div>
              <HTMLTable compact striped data-table="image.scanning.scanner.program">
                <tbody>
                  <tr>
                    <td>{t("Scanner")}</td>
                    <td>{report?.scanner?.name}</td>
                  </tr>
                  <tr>
                    <td>{t("Path")}</td>
                    <td>{report?.scanner?.path}</td>
                  </tr>
                  <tr>
                    <td>{t("Version")}</td>
                    <td>{report?.scanner?.version}</td>
                  </tr>
                </tbody>
              </HTMLTable>
              <Divider />
              <HTMLTable compact striped data-table="image.scanning.scanner.database">
                <tbody>
                  <tr>
                    <td>{t("Database")}</td>
                    <td>{report?.scanner?.database?.VulnerabilityDB?.Version || ""}</td>
                  </tr>
                  <tr>
                    <td>{t("Downloaded")}</td>
                    <td>{report?.scanner?.database?.VulnerabilityDB?.DownloadedAt ? (dayjs(report?.scanner?.database?.VulnerabilityDB?.DownloadedAt) as any).fromNow() : ""}</td>
                  </tr>
                  <tr>
                    <td>{t("Updated")}</td>
                    <td>{report?.scanner?.database?.VulnerabilityDB?.UpdatedAt ? (dayjs(report?.scanner?.database?.VulnerabilityDB?.UpdatedAt) as any).fromNow() : ""}</td>
                  </tr>
                </tbody>
              </HTMLTable>
              <Divider />
              <AnchorButton icon={IconNames.HOME} intent={Intent.PRIMARY} href="https://trivy.dev" target="_blank" rel="noOpener">
                <span>Trivy</span>
              </AnchorButton>
            </div>

            {report && report.scanner?.path && report.status === "success" ? (
              <div className="SecurityList">
                <HTMLTable compact className="AppDataTable" data-table="image.scanning.report">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("Vulnerability ID")}</th>
                      <th>{t("Severity")}</th>
                      <th>{t("Class")}</th>
                      <th>{t("Target")}</th>
                      <th>{t("Type")}</th>
                      <th>{t("Published")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.result?.Results || []).reduce((acc, group: SecurityReportResultGroup) => {
                      const items = group.Vulnerabilities.map((vulnerability: SecurityVulnerability) => {
                        const key = vulnerability.guid;
                        count += 1;
                        const highlight = count % 2 === 0 ? "even" : "odd";
                        return (
                          <React.Fragment key={key}>
                            <tr data-row-highlight={highlight} data-severity={vulnerability.Severity}>
                              <td>
                                <span>{count}</span>
                              </td>
                              <td>
                                <AnchorButton
                                  className="OpenURLButton"
                                  icon={IconNames.LINK}
                                  rel="noOpener"
                                  href={vulnerability.PrimaryURL}
                                  text={vulnerability.VulnerabilityID}
                                  target="_blank"
                                  minimal
                                  intent={Intent.PRIMARY}
                                />
                              </td>
                              <td>
                                <span className="Severity">{vulnerability.Severity}</span>
                              </td>
                              <td>{group.Class}</td>
                              <td>{group.Target}</td>
                              <td>{group.Type}</td>
                              <td>{dayjs(vulnerability.Published).format("DD MMM YYYY HH:mm")}</td>
                            </tr>
                            <tr data-row-highlight={highlight} data-severity={vulnerability.Severity}>
                              <td colSpan={9} data-field="Description">
                                <p>{vulnerability.Description}</p>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      });
                      count += 1;
                      acc.push(...items);
                      return acc;
                    }, [] as any)}
                  </tbody>
                </HTMLTable>
              </div>
            ) : (
              <NonIdealState
                icon={IconNames.WARNING_SIGN}
                title={t("Report could not be generated")}
                description={
                  report?.scanner?.path ? (
                    <p>{t("An internal error occurred, please report the issue.")}</p>
                  ) : (
                    <>
                      <p>{t("Please install trivy and then revisit this screen")}</p>
                    </>
                  )
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/image/:id/security`
};
Screen.Metadata = {
  LeftIcon: IconNames.CONFIRM,
  ExcludeFromSidebar: true
};
