// One-off build script for DE-87.
// Synthesizes Pricefx_Transaction_Daily_0.1.{item,properties} from the
// Heads_Up_Email_vT8_0.1 template + Phocas tDBConnection setup, swapping in:
//   - Our 54-column SELECT against ODS.CONSOLIDATION.INVOICEDSALES
//   - Schema metadata for the 54 output columns
//   - 7 SFTP context parameters (values blank — set in Studio Run > Context)
//   - tNote annotation marking where tFTPPut goes (you place it in Studio)
//
// This is best-effort XML synthesis — Studio may auto-fix things on first
// open. The framework is lifted verbatim from a working Reece job, so the
// risk is concentrated in the new bits (schema, SQL, context, tNote).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const REPO_ROOT = "C:/t8de83";
const TEMPLATE_ITEM = "C:/Users/alejandro.salas/Documents/ASO/JanusAI/janus-ia/dump/uploads/Heads_Up_Email_vT8_0.1.item.xml";
const SQL_FILE     = "C:/Users/alejandro.salas/Documents/ASO/JanusAI/janus-ia/tickets/DE-87/select.sql";
const OUT_DIR      = path.join(REPO_ROOT, "TALEND_8/process/DEV/AlejandroSalas/PriceFX");
const JOB_NAME     = "Pricefx_Transaction_Daily_0.1";

// 54 columns in spec order, with Pfx Column Name → Talend type
// (id_String / id_Integer / id_BigDecimal / id_Date)
const COLS = [
  ["TransactionID",                "id_String",     16777216, -1],
  ["ProductID",                    "id_String",     16777216, -1],
  ["BillToCustomerID",             "id_String",     16777216, -1],
  ["CustomerID",                   "id_String",     16777216, -1],
  ["PDWID",                        "id_String",     16777216, -1],
  ["GLDate",                       "id_Date",       -1,       -1],
  ["InvoiceNumber",                "id_String",     16777216, -1],
  ["LineNumber",                   "id_Integer",    10,       0 ],
  ["OrderDate",                    "id_Date",       -1,       -1],
  ["BillToCustomerKey",            "id_String",     16777216, -1],
  ["BillToCustomerMonthKey",       "id_String",     16777216, -1],
  ["ProductIDLedger",              "id_String",     16777216, -1],
  ["WriterID",                     "id_String",     16777216, -1],
  ["InsideSalesPersonID",          "id_String",     16777216, -1],
  ["OutsideSalesPersonID",         "id_String",     16777216, -1],
  ["ShipBranchID",                 "id_String",     16777216, -1],
  ["BranchID",                     "id_String",     16777216, -1],
  ["Region",                       "id_String",     16777216, -1],
  ["SalesSource",                  "id_String",     16777216, -1],
  ["TermSCD",                      "id_String",     16777216, -1],
  ["OrderStatus",                  "id_String",     16777216, -1],
  ["PrintStatus",                  "id_String",     16777216, -1],
  ["GLDateNumeric",                "id_String",     16777216, -1],
  ["ShipDate",                     "id_Date",       -1,       -1],
  ["ProcessDate",                  "id_Date",       -1,       -1],
  ["RequiredDate",                 "id_Date",       -1,       -1],
  ["DiscountDate",                 "id_Date",       -1,       -1],
  ["DueDate",                      "id_Date",       -1,       -1],
  ["OrderQty",                     "id_BigDecimal", 38,       4 ],
  ["StockQty",                     "id_Integer",    10,       0 ],
  ["DirectQty",                    "id_Integer",    10,       0 ],
  ["ExtPrice",                     "id_BigDecimal", 38,       4 ],
  ["ExtCOGS",                      "id_BigDecimal", 38,       4 ],
  ["EXTCost",                      "id_BigDecimal", 38,       4 ],
  ["CostGP",                       "id_BigDecimal", 38,       4 ],
  ["PriceOverride",                "id_BigDecimal", 38,       4 ],
  ["ExtCOGSOverride",              "id_BigDecimal", 38,       4 ],
  ["ShipViaID",                    "id_String",     16777216, -1],
  ["PriceContract",                "id_String",     16777216, -1],
  ["ReturnCode",                   "id_String",     16777216, -1],
  ["RemoteData",                   "id_String",     16777216, -1],
  ["MaxFlag",                      "id_String",     16777216, -1],
  ["PricingTypeMOD",               "id_String",     16777216, -1],
  ["PricingType",                  "id_String",     16777216, -1],
  ["RateCardID",                   "id_String",     16777216, -1],
  ["TableCreateDate",              "id_Date",       -1,       -1],
  ["ActiveCustomerKey",            "id_String",     16777216, -1],
  ["Division",                     "id_String",     16777216, -1],
  ["ExtLocalCMP",                  "id_BigDecimal", 38,       4 ],
  ["ExtNationalCMP",               "id_BigDecimal", 38,       4 ],
  ["ExtListPrice",                 "id_BigDecimal", 38,       4 ],
  ["ExtBaseTradeRate",             "id_BigDecimal", 38,       4 ],
  ["ExtRateCardTradeRate",         "id_BigDecimal", 38,       4 ],
  ["ExtBestPriceAcrossSpecials",   "id_BigDecimal", 38,       4 ],
  ["ExtFinalInvoicePrice",         "id_BigDecimal", 38,       4 ],
];

const sql = fs.readFileSync(SQL_FILE, "utf-8")
  .replace(/^\s*--.*$/gm, "") // strip line comments
  .replace(/\s*;\s*$/, "")     // strip trailing semicolon
  .trim();
// XML-escape for embedding in MEMO_SQL value=" ... "
function xmlAttr(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "&#xD;&#xA;");
}
const sqlEscaped = `&quot;${xmlAttr(sql)}&quot;`;

function newId() {
  // Match Talend's "_xxx" GUID-ish style
  return "_" + crypto.randomBytes(12).toString("base64url").slice(0, 22);
}

function colsToMetadataXml(connector, name) {
  const cols = COLS.map(([n, t, len, prec]) => `      <column comment="" key="false" length="${len}" name="${n}" nullable="true" pattern="" precision="${prec}" type="${t}" originalLength="-1" usefulColumn="true">
        <additionalField key="AVRO_TECHNICAL_KEY" value="${n}"/>
      </column>`).join("\n");
  return `    <metadata connector="${connector}" label="MAIN" name="${name}">
${cols}
    </metadata>`;
}

// Build the new .item from scratch (cleaner than surgically editing the
// 600-line template). We borrow the SnowflakeConnection block verbatim from
// the template since it has the encrypted creds Studio expects.

const tpl = fs.readFileSync(TEMPLATE_ITEM, "utf-8");

// Extract the SnowflakeConnection node verbatim — it has encrypted creds
// that Studio's project-level encryption key can decode. We change role +
// database after embedding.
const snowflakeConnMatch = tpl.match(/<node componentName="SnowflakeConnection"[\s\S]*?<\/node>/);
if (!snowflakeConnMatch) throw new Error("no SnowflakeConnection in template");
let snowflakeConn = snowflakeConnMatch[0];
// Switch role to DATA_ENGINEER (per AGENTS.md substrate); database to ODS;
// schema to CONSOLIDATION; warehouse keep.
snowflakeConn = snowflakeConn
  .replace(/(name="configuration\.role" value=)"[^"]*"/, '$1"&quot;DATA_ENGINEER&quot;"')
  .replace(/(name="configuration\.database" value=)"[^"]*"/, '$1"&quot;ODS&quot;"')
  .replace(/(name="configuration\.dbSchema" value=)"[^"]*"/, '$1"&quot;CONSOLIDATION&quot;"')
  .replace(/(name="LABEL" value=)"[^"]*"/, '$1"DE-87 SF"');

// Build fresh .item
const item = `<?xml version="1.0" encoding="UTF-8"?>
<talendfile:ProcessType xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:talendfile="platform:/resource/org.talend.model/model/TalendFile.xsd" defaultContext="Default" jobType="Standard">
  <context confirmationNeeded="false" hide="false" name="Default">
    <contextParameter comment="Pricefx SFTP host"           name="pfx_sftp_host"       prompt="pfx_sftp_host?"       promptNeeded="false" repositoryContextId="built-in" type="id_String"   value=""                                          internalId="${newId()}"/>
    <contextParameter comment="Pricefx SFTP port"           name="pfx_sftp_port"       prompt="pfx_sftp_port?"       promptNeeded="false" repositoryContextId="built-in" type="id_String"   value="22"                                        internalId="${newId()}"/>
    <contextParameter comment="Pricefx SFTP username"       name="pfx_sftp_user"       prompt="pfx_sftp_user?"       promptNeeded="false" repositoryContextId="built-in" type="id_String"   value=""                                          internalId="${newId()}"/>
    <contextParameter comment="Pricefx SFTP password"       name="pfx_sftp_password"   prompt="pfx_sftp_password?"   promptNeeded="false" repositoryContextId="built-in" type="id_Password" value=""                                          internalId="${newId()}"/>
    <contextParameter comment="Pricefx SFTP remote dir"     name="pfx_sftp_remote_dir" prompt="pfx_sftp_remote_dir?" promptNeeded="false" repositoryContextId="built-in" type="id_String"   value="/filearea/outbound/transaction"            internalId="${newId()}"/>
    <contextParameter comment="Local CSV dir"               name="local_csv_dir"       prompt="local_csv_dir?"       promptNeeded="false" repositoryContextId="built-in" type="id_Directory" value="C:/tmp/pfx"                               internalId="${newId()}"/>
    <contextParameter comment="CSV filename for the day"    name="csv_filename"        prompt="csv_filename?"        promptNeeded="false" repositoryContextId="built-in" type="id_String"   value=""                                          internalId="${newId()}"/>
  </context>
  <parameters>
    <elementParameter field="CLOSED_LIST" name="LOG4J_RUN_LEVEL" value="Info" show="false"/>
    <elementParameter field="TEXT" name="JOB_RUN_VM_ARGUMENTS" value="{&quot;JOB_RUN_VM_ARGUMENTS&quot;:[&quot;-Xms2560M&quot;,&quot;-Xmx10240M&quot;]}" show="false"/>
    <elementParameter field="CHECK" name="JOB_RUN_VM_ARGUMENTS_OPTION" value="true" show="false"/>
    <elementParameter field="TEXT" name="SCREEN_OFFSET_X" value="0" show="false"/>
    <elementParameter field="TEXT" name="SCREEN_OFFSET_Y" value="0" show="false"/>
    <elementParameter field="CHECK" name="MULTI_THREAD_EXECATION" value="false"/>
    <elementParameter field="TEXT" name="PARALLELIZE_UNIT_SIZE" value="25000"/>
    <elementParameter field="ENCODING_TYPE" name="ENCODING" value="UTF-8" show="false"/>
    <elementParameter field="TECHNICAL" name="ENCODING:ENCODING_TYPE" value="UTF-8" show="false"/>
    <elementParameter field="CHECK" name="ON_STATCATCHER_FLAG" value="false"/>
    <elementParameter field="CHECK" name="ON_LOGCATCHER_FLAG" value="false"/>
    <elementParameter field="CHECK" name="ON_METERCATCHER_FLAG" value="false"/>
    <elementParameter field="CHECK" name="ON_CONSOLE_FLAG" value="false" show="false"/>
    <elementParameter field="CHECK" name="ON_FILES_FLAG" value="false" show="false"/>
    <elementParameter field="DIRECTORY" name="FILE_PATH" value="&quot;.metadata&quot;" show="false"/>
    <elementParameter field="TEXT" name="FILENAME_STATS" value="&quot;stats_file.txt&quot;" show="false"/>
    <elementParameter field="TEXT" name="FILENAME_LOGS" value="&quot;logs_file.txt&quot;" show="false"/>
    <elementParameter field="TEXT" name="FILENAME_METTER" value="&quot;meter_file.txt&quot;" show="false"/>
  </parameters>
  <node componentName="tPrejob" componentVersion="0.102" offsetLabelX="0" offsetLabelY="0" posX="40" posY="40">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tPrejob_1" show="false"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
  </node>
  <node componentName="tJava" componentVersion="0.101" offsetLabelX="0" offsetLabelY="0" posX="240" posY="40">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tJava_SetFilename" show="false"/>
    <elementParameter field="MEMO_JAVA" name="CODE" value="// Default csv_filename to transactions_yyyyMMdd.csv (yesterday) if not set.&#xA;if (context.csv_filename == null || context.csv_filename.isEmpty()) {&#xA;  java.util.Date yesterday = TalendDate.addDate(TalendDate.getCurrentDate(), -1, &quot;dd&quot;);&#xA;  context.csv_filename = &quot;transactions_&quot; + TalendDate.formatDate(&quot;yyyyMMdd&quot;, yesterday) + &quot;.csv&quot;;&#xA;}&#xA;System.out.println(&quot;[DE-87] csv_filename = &quot; + context.csv_filename);&#xA;"/>
    <elementParameter field="MEMO_IMPORT" name="IMPORT" value=""/>
    <elementParameter field="TEXT" name="LABEL" value="Resolve filename"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
    <metadata connector="FLOW" name="tJava_SetFilename"/>
  </node>
${snowflakeConn.replace('posX="440" posY="40"', 'posX="440" posY="40"')}
  <node componentName="SnowflakeInput" componentVersion="1" offsetLabelX="0" offsetLabelY="0" posX="40" posY="240">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tDBInput_1" show="false"/>
    <elementParameter field="QUERYSTORE_TYPE" name="QUERYSTORE" value="" show="false"/>
    <elementParameter field="TECHNICAL" name="QUERYSTORE:REPOSITORY_QUERYSTORE_TYPE" value="" show="false"/>
    <elementParameter field="TECHNICAL" name="QUERYSTORE:QUERYSTORE_TYPE" value="BUILT_IN"/>
    <elementParameter field="TEXT" name="LABEL" value="DE-87 InvoicedSales (yesterday)"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
    <elementParameter field="TECHNICAL" name="TACOKIT_COMPONENT_ID" value="c25vd2ZsYWtlI1Nub3dmbGFrZSNJbnB1dA"/>
    <elementParameter field="CHECK" name="USE_EXISTING_CONNECTION" value="true"/>
    <elementParameter field="COMPONENT_LIST" name="CONNECTION" value="tDBConnection_1"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.account" value="&quot;&quot;"/>
    <elementParameter field="CLOSED_LIST" name="configuration.dataSet.dataStore.snowflakeAuth.authenticationType" value="BASIC"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.snowflakeAuth.userId" value="&quot;&quot;"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.warehouse" value="&quot;&quot;"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.dbSchema" value="&quot;&quot;"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.database" value="&quot;&quot;"/>
    <elementParameter field="CHECK" name="configuration.dataSet.dataStore.autoCommit" value="true"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.jdbcParameters" value="&quot;&quot;"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.loginTimeout" value="15"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.role" value="&quot;&quot;"/>
    <elementParameter field="TEXT" name="configuration.dataSet.dataStore.jdbcUrlSuffix" value="&quot;.snowflakecomputing.com&quot;"/>
    <elementParameter field="TACOKIT_VALUE_SELECTION" name="configuration.dataSet.tableName" value="&quot;&quot;"/>
    <elementParameter field="CHECK" name="configuration.dataSet.manualQuery" value="true"/>
    <elementParameter field="MEMO_SQL" name="configuration.dataSet.sqlQuery" value="${sqlEscaped}"/>
    <elementParameter field="TEXT" name="configuration.dataSet.condition" value="&quot;&quot;"/>
    <elementParameter field="CHECK" name="configuration.dataSet.useUnquotedObjectIdentifiers" value="true"/>
    <elementParameter field="CHECK" name="configuration.dataSet.useSessionTimezone" value="false"/>
    <elementParameter field="TECHNICAL" name="configuration.dataSet.__version" value="-1"/>
    <elementParameter field="TECHNICAL" name="configuration.dataSet.dataStore.__version" value="-1"/>
${colsToMetadataXml("FLOW", "tDBInput_1")}
  </node>
  <node componentName="tFileOutputDelimited" componentVersion="0.101" offsetLabelX="0" offsetLabelY="0" posX="320" posY="240">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tFileOutputDelimited_1" show="false"/>
    <elementParameter field="CHECK" name="USESTREAM" value="false"/>
    <elementParameter field="TEXT" name="STREAMNAME" value="outputStream" show="false"/>
    <elementParameter field="FILE" name="FILENAME" value="context.local_csv_dir + &quot;/&quot; + context.csv_filename"/>
    <elementParameter field="TEXT" name="ROWSEPARATOR" value="&quot;\\n&quot;" show="false"/>
    <elementParameter field="CHECK" name="OS_LINE_SEPARATOR_AS_ROW_SEPARATOR" value="false"/>
    <elementParameter field="OPENED_LIST" name="CSVROWSEPARATOR" value="&quot;\\n&quot;"/>
    <elementParameter field="TEXT" name="FIELDSEPARATOR" value="&quot;,&quot;"/>
    <elementParameter field="CHECK" name="APPEND" value="false"/>
    <elementParameter field="CHECK" name="INCLUDEHEADER" value="true"/>
    <elementParameter field="CHECK" name="COMPRESS" value="false"/>
    <elementParameter field="CHECK" name="ADVANCED_SEPARATOR" value="false"/>
    <elementParameter field="TEXT" name="THOUSANDS_SEPARATOR" value="&quot;,&quot;" show="false"/>
    <elementParameter field="TEXT" name="DECIMAL_SEPARATOR" value="&quot;.&quot;" show="false"/>
    <elementParameter field="CHECK" name="CSV_OPTION" value="true"/>
    <elementParameter field="TEXT" name="ESCAPE_CHAR" value="&quot;\\&quot;&quot;"/>
    <elementParameter field="TEXT" name="TEXT_ENCLOSURE" value="&quot;\\&quot;&quot;"/>
    <elementParameter field="CHECK" name="CREATE" value="true"/>
    <elementParameter field="CHECK" name="SPLIT" value="false"/>
    <elementParameter field="CHECK" name="FLUSHONROW" value="false"/>
    <elementParameter field="CHECK" name="ROW_MODE" value="false"/>
    <elementParameter field="ENCODING_TYPE" name="ENCODING" value="&quot;UTF-8&quot;"/>
    <elementParameter field="TECHNICAL" name="ENCODING:ENCODING_TYPE" value="UTF-8"/>
    <elementParameter field="CHECK" name="DELETE_EMPTYFILE" value="false"/>
    <elementParameter field="CHECK" name="FILE_EXIST_EXCEPTION" value="false"/>
    <elementParameter field="TEXT" name="LABEL" value="Write CSV (UTF-8)"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
${colsToMetadataXml("FLOW", "tFileOutputDelimited_1")}
  </node>
  <node componentName="tJava" componentVersion="0.101" offsetLabelX="0" offsetLabelY="0" posX="600" posY="240">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tJava_PostWrite" show="false"/>
    <elementParameter field="MEMO_JAVA" name="CODE" value="// TODO: tFTPPut goes between this tJava and tPostjob.&#xA;//   Wire after tFileOutputDelimited_1 (OnComponentOk).&#xA;//   Configure with: context.pfx_sftp_host / port / user / password,&#xA;//   remote dir = context.pfx_sftp_remote_dir,&#xA;//   local dir  = context.local_csv_dir,&#xA;//   files     = context.csv_filename,&#xA;//   USE SFTP = true.&#xA;Integer rows = (Integer)globalMap.get(&quot;tFileOutputDelimited_1_NB_LINE&quot;);&#xA;System.out.println(&quot;[DE-87] wrote &quot; + rows + &quot; rows to &quot; + context.local_csv_dir + &quot;/&quot; + context.csv_filename);&#xA;"/>
    <elementParameter field="MEMO_IMPORT" name="IMPORT" value=""/>
    <elementParameter field="TEXT" name="LABEL" value="Log + TODO tFTPPut"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
    <metadata connector="FLOW" name="tJava_PostWrite"/>
  </node>
  <node componentName="tPostjob" componentVersion="0.102" offsetLabelX="0" offsetLabelY="0" posX="40" posY="440">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tPostjob_1" show="false"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
  </node>
  <node componentName="SnowflakeClose" componentVersion="1" offsetLabelX="0" offsetLabelY="0" posX="240" posY="440">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="tDBClose_1" show="false"/>
    <elementParameter field="QUERYSTORE_TYPE" name="QUERYSTORE" value="" show="false"/>
    <elementParameter field="TECHNICAL" name="QUERYSTORE:REPOSITORY_QUERYSTORE_TYPE" value="" show="false"/>
    <elementParameter field="TECHNICAL" name="QUERYSTORE:QUERYSTORE_TYPE" value="BUILT_IN"/>
    <elementParameter field="TEXT" name="LABEL" value="SF Close"/>
    <elementParameter field="TEXT" name="CONNECTION_FORMAT" value="row"/>
    <elementParameter field="TECHNICAL" name="TACOKIT_COMPONENT_ID" value="c25vd2ZsYWtlI1Nub3dmbGFrZSNJbnB1dAClose"/>
    <elementParameter field="CHECK" name="USE_EXISTING_CONNECTION" value="true"/>
    <elementParameter field="COMPONENT_LIST" name="CONNECTION" value="tDBConnection_1"/>
  </node>
  <connection connectorName="COMPONENT_OK" label="OnComponentOk" lineStyle="3" metaname="tPrejob_1" offsetLabelX="0" offsetLabelY="0" source="tPrejob_1" target="tJava_SetFilename">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="OnComponentOk1" show="false"/>
  </connection>
  <connection connectorName="COMPONENT_OK" label="OnComponentOk" lineStyle="3" metaname="tJava_SetFilename" offsetLabelX="0" offsetLabelY="0" source="tJava_SetFilename" target="tDBConnection_1">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="OnComponentOk2" show="false"/>
  </connection>
  <connection connectorName="FLOW" label="row1" lineStyle="0" metaname="tDBInput_1" offsetLabelX="0" offsetLabelY="0" source="tDBInput_1" target="tFileOutputDelimited_1">
    <elementParameter field="CHECK" name="MONITOR_CONNECTION" value="false"/>
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="row1" show="false"/>
  </connection>
  <connection connectorName="COMPONENT_OK" label="OnComponentOk" lineStyle="3" metaname="tFileOutputDelimited_1" offsetLabelX="0" offsetLabelY="0" source="tFileOutputDelimited_1" target="tJava_PostWrite">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="OnComponentOk3" show="false"/>
  </connection>
  <connection connectorName="COMPONENT_OK" label="OnComponentOk" lineStyle="3" metaname="tPostjob_1" offsetLabelX="0" offsetLabelY="0" source="tPostjob_1" target="tDBClose_1">
    <elementParameter field="TEXT" name="UNIQUE_NAME" value="OnComponentOk4" show="false"/>
  </connection>
  <subjob backgroundColor="14545407" foregroundColor="0" collapsed="false" showSubjobTitle="true" showSubjobOvalRect="true" subjobTitleColor="-13434829" title="DE-87 daily Pricefx Transaction (DS) extract&#xD;&#xA;1) Resolve csv filename (yesterday)&#xD;&#xA;2) Open Snowflake conn&#xD;&#xA;3) SELECT yesterday's INVOICEDSALES rows (54 cols)&#xD;&#xA;4) Write CSV (UTF-8, comma, header)&#xD;&#xA;5) [Studio TODO] drop tFTPPut here, push to /filearea/outbound/transaction" titleSize="10">
    <elementParameter field="TEXT" name="SUBJOB_TITLE_BACKGROUND_COLOR" value="14545407" show="false"/>
    <elementParameter field="TEXT" name="SUBJOB_TITLE_FOREGROUND_COLOR" value="-13434829" show="false"/>
    <elementParameter field="TEXT" name="SUBJOB_TITLE_BORDER_COLOR" value="-1" show="false"/>
    <elementParameter field="TEXT" name="SUBJOB_TITLE_TITLESIZE" value="10" show="false"/>
  </subjob>
</talendfile:ProcessType>
`;

const propsId = newId().replace(/^_/, "_") + "T";
const propertiesXml = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.0" xmlns:xmi="http://www.omg.org/XMI" xmlns:talendfile="platform:/resource/org.talend.model/model/TalendFile.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <talendfile:ProjectReference href="../../../../../talend.project#/"/>
  <talendfile:ItemState path=""/>
  <talendfile:Property author="//@TalendProperties/@authors.0" creationDate="${new Date().toISOString()}" description="DE-87 daily incremental sales transactions for Pricefx Transaction (DS)" displayName="${JOB_NAME}" id="${propsId}" label="${JOB_NAME}" modificationDate="${new Date().toISOString()}" purpose="Extract daily INVOICEDSALES delta and write CSV for Pricefx pickup at /filearea/outbound/transaction" statusCode="" version="0.1">
    <additionalProperties key="ITEM_RELATIVE_PATH" value="DEV/AlejandroSalas/PriceFX"/>
  </talendfile:Property>
</xmi:XMI>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, JOB_NAME + ".item"), item, "utf-8");
fs.writeFileSync(path.join(OUT_DIR, JOB_NAME + ".properties"), propertiesXml, "utf-8");
// minimal screenshot — Studio regenerates on first save
fs.writeFileSync(path.join(OUT_DIR, JOB_NAME + ".screenshot"),
  Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFFFF3F00000500010065BE6B370000000049454E44AE426082", "hex"));

console.log("wrote:");
for (const f of fs.readdirSync(OUT_DIR)) console.log("  " + path.join(OUT_DIR, f));
console.log("\n.item bytes:", fs.statSync(path.join(OUT_DIR, JOB_NAME + ".item")).size);
console.log(".properties bytes:", fs.statSync(path.join(OUT_DIR, JOB_NAME + ".properties")).size);
