// HL7 v2.5 dictionary: segment names, field names, message type descriptions, ACK codes.
// Browser-safe ESM, no imports. fields[0] is unused (''), fields[n] is the name of SEG-n.

function seg(name, fields) {
  return { name, fields: ['', ...fields] };
}

export const SEGMENTS = {
  MSH: seg('Message Header', [
    'Field Separator', 'Encoding Characters', 'Sending Application', 'Sending Facility',
    'Receiving Application', 'Receiving Facility', 'Date/Time Of Message', 'Security', 'Message Type',
    'Message Control ID', 'Processing ID', 'Version ID', 'Sequence Number', 'Continuation Pointer',
    'Accept Acknowledgment Type', 'Application Acknowledgment Type', 'Country Code', 'Character Set',
    'Principal Language Of Message', 'Alternate Character Set Handling Scheme', 'Message Profile Identifier'
  ]),
  MSA: seg('Message Acknowledgment', [
    'Acknowledgment Code', 'Message Control ID', 'Text Message', 'Expected Sequence Number',
    'Delayed Acknowledgment Type', 'Error Condition'
  ]),
  ERR: seg('Error', [
    'Error Code and Location', 'Error Location', 'HL7 Error Code', 'Severity', 'Application Error Code',
    'Application Error Parameter', 'Diagnostic Information', 'User Message', 'Inform Person Indicator',
    'Override Type', 'Override Reason Code', 'Help Desk Contact Point'
  ]),
  EVN: seg('Event Type', [
    'Event Type Code', 'Recorded Date/Time', 'Date/Time Planned Event', 'Event Reason Code', 'Operator ID',
    'Event Occurred', 'Event Facility'
  ]),
  PID: seg('Patient Identification', [
    'Set ID - PID', 'Patient ID', 'Patient Identifier List', 'Alternate Patient ID - PID', 'Patient Name',
    "Mother's Maiden Name", 'Date/Time of Birth', 'Administrative Sex', 'Patient Alias', 'Race',
    'Patient Address', 'County Code', 'Phone Number - Home', 'Phone Number - Business', 'Primary Language',
    'Marital Status', 'Religion', 'Patient Account Number', 'SSN Number - Patient',
    "Driver's License Number - Patient", "Mother's Identifier", 'Ethnic Group', 'Birth Place',
    'Multiple Birth Indicator', 'Birth Order', 'Citizenship', 'Veterans Military Status', 'Nationality',
    'Patient Death Date and Time', 'Patient Death Indicator', 'Identity Unknown Indicator',
    'Identity Reliability Code', 'Last Update Date/Time', 'Last Update Facility', 'Species Code', 'Breed Code',
    'Strain', 'Production Class Code', 'Tribal Citizenship'
  ]),
  PD1: seg('Patient Additional Demographic', [
    'Living Dependency', 'Living Arrangement', 'Patient Primary Facility',
    'Patient Primary Care Provider Name & ID No.', 'Student Indicator', 'Handicap', 'Living Will Code',
    'Organ Donor Code', 'Separate Bill', 'Duplicate Patient', 'Publicity Code', 'Protection Indicator',
    'Protection Indicator Effective Date', 'Place of Worship', 'Advance Directive Code',
    'Immunization Registry Status', 'Immunization Registry Status Effective Date',
    'Publicity Code Effective Date', 'Military Branch', 'Military Rank/Grade', 'Military Status'
  ]),
  NK1: seg('Next of Kin / Associated Parties', [
    'Set ID - NK1', 'Name', 'Relationship', 'Address', 'Phone Number', 'Business Phone Number', 'Contact Role',
    'Start Date', 'End Date', 'Next of Kin / Associated Parties Job Title',
    'Next of Kin / Associated Parties Job Code/Class', 'Next of Kin / Associated Parties Employee Number',
    'Organization Name - NK1', 'Marital Status', 'Administrative Sex', 'Date/Time of Birth', 'Living Dependency',
    'Ambulatory Status', 'Citizenship', 'Primary Language', 'Living Arrangement', 'Publicity Code',
    'Protection Indicator', 'Student Indicator', 'Religion', "Mother's Maiden Name", 'Nationality',
    'Ethnic Group', 'Contact Reason', "Contact Person's Name", "Contact Person's Telephone Number",
    "Contact Person's Address", "Next of Kin/Associated Party's Identifiers", 'Job Status', 'Race', 'Handicap',
    'Contact Person Social Security Number', 'Next of Kin Birth Place', 'VIP Indicator'
  ]),
  PV1: seg('Patient Visit', [
    'Set ID - PV1', 'Patient Class', 'Assigned Patient Location', 'Admission Type', 'Preadmit Number',
    'Prior Patient Location', 'Attending Doctor', 'Referring Doctor', 'Consulting Doctor', 'Hospital Service',
    'Temporary Location', 'Preadmit Test Indicator', 'Re-admission Indicator', 'Admit Source',
    'Ambulatory Status', 'VIP Indicator', 'Admitting Doctor', 'Patient Type', 'Visit Number', 'Financial Class',
    'Charge Price Indicator', 'Courtesy Code', 'Credit Rating', 'Contract Code', 'Contract Effective Date',
    'Contract Amount', 'Contract Period', 'Interest Code', 'Transfer to Bad Debt Code',
    'Transfer to Bad Debt Date', 'Bad Debt Agency Code', 'Bad Debt Transfer Amount', 'Bad Debt Recovery Amount',
    'Delete Account Indicator', 'Delete Account Date', 'Discharge Disposition', 'Discharged to Location',
    'Diet Type', 'Servicing Facility', 'Bed Status', 'Account Status', 'Pending Location',
    'Prior Temporary Location', 'Admit Date/Time', 'Discharge Date/Time', 'Current Patient Balance',
    'Total Charges', 'Total Adjustments', 'Total Payments', 'Alternate Visit ID', 'Visit Indicator',
    'Other Healthcare Provider'
  ]),
  PV2: seg('Patient Visit - Additional Information', [
    'Prior Pending Location', 'Accommodation Code', 'Admit Reason', 'Transfer Reason', 'Patient Valuables',
    'Patient Valuables Location', 'Visit User Code', 'Expected Admit Date/Time', 'Expected Discharge Date/Time',
    'Estimated Length of Inpatient Stay', 'Actual Length of Inpatient Stay', 'Visit Description',
    'Referral Source Code', 'Previous Service Date', 'Employment Illness Related Indicator', 'Purge Status Code',
    'Purge Status Date', 'Special Program Code', 'Retention Indicator', 'Expected Number of Insurance Plans',
    'Visit Publicity Code', 'Visit Protection Indicator', 'Clinic Organization Name', 'Patient Status Code',
    'Visit Priority Code', 'Previous Treatment Date', 'Expected Discharge Disposition', 'Signature on File Date',
    'First Similar Illness Date', 'Patient Charge Adjustment Code', 'Recurring Service Code',
    'Billing Media Code', 'Expected Surgery Date and Time', 'Military Partnership Code',
    'Military Non-Availability Code', 'Newborn Baby Indicator', 'Baby Detained Indicator',
    'Mode of Arrival Code', 'Recreational Drug Use Code', 'Admission Level of Care Code', 'Precaution Code',
    'Patient Condition Code', 'Living Will Code', 'Organ Donor Code', 'Advance Directive Code',
    'Patient Status Effective Date', 'Expected LOA Return Date/Time', 'Expected Pre-admission Testing Date/Time',
    'Notify Clergy Code'
  ]),
  ORC: seg('Common Order', [
    'Order Control', 'Placer Order Number', 'Filler Order Number', 'Placer Group Number', 'Order Status',
    'Response Flag', 'Quantity/Timing', 'Parent', 'Date/Time of Transaction', 'Entered By', 'Verified By',
    'Ordering Provider', "Enterer's Location", 'Call Back Phone Number', 'Order Effective Date/Time',
    'Order Control Code Reason', 'Entering Organization', 'Entering Device', 'Action By',
    'Advanced Beneficiary Notice Code', 'Ordering Facility Name', 'Ordering Facility Address',
    'Ordering Facility Phone Number', 'Ordering Provider Address', 'Order Status Modifier',
    'Advanced Beneficiary Notice Override Reason', "Filler's Expected Availability Date/Time",
    'Confidentiality Code', 'Order Type', 'Enterer Authorization Mode', 'Parent Universal Service Identifier'
  ]),
  OBR: seg('Observation Request', [
    'Set ID - OBR', 'Placer Order Number', 'Filler Order Number', 'Universal Service Identifier',
    'Priority - OBR', 'Requested Date/Time', 'Observation Date/Time', 'Observation End Date/Time',
    'Collection Volume', 'Collector Identifier', 'Specimen Action Code', 'Danger Code',
    'Relevant Clinical Information', 'Specimen Received Date/Time', 'Specimen Source', 'Ordering Provider',
    'Order Callback Phone Number', 'Placer Field 1', 'Placer Field 2', 'Filler Field 1', 'Filler Field 2',
    'Results Rpt/Status Chng - Date/Time', 'Charge to Practice', 'Diagnostic Serv Sect ID', 'Result Status',
    'Parent Result', 'Quantity/Timing', 'Result Copies To', 'Parent', 'Transportation Mode', 'Reason for Study',
    'Principal Result Interpreter', 'Assistant Result Interpreter', 'Technician', 'Transcriptionist',
    'Scheduled Date/Time', 'Number of Sample Containers', 'Transport Logistics of Collected Sample',
    "Collector's Comment", 'Transport Arrangement Responsibility', 'Transport Arranged', 'Escort Required',
    'Planned Patient Transport Comment', 'Procedure Code', 'Procedure Code Modifier',
    'Placer Supplemental Service Information', 'Filler Supplemental Service Information',
    'Medically Necessary Duplicate Procedure Reason', 'Result Handling'
  ]),
  OBX: seg('Observation/Result', [
    'Set ID - OBX', 'Value Type', 'Observation Identifier', 'Observation Sub-ID', 'Observation Value', 'Units',
    'References Range', 'Abnormal Flags', 'Probability', 'Nature of Abnormal Test', 'Observation Result Status',
    'Effective Date of Reference Range', 'User Defined Access Checks', 'Date/Time of the Observation',
    "Producer's ID", 'Responsible Observer', 'Observation Method', 'Equipment Instance Identifier',
    'Date/Time of the Analysis'
  ]),
  NTE: seg('Notes and Comments', [
    'Set ID - NTE', 'Source of Comment', 'Comment', 'Comment Type'
  ]),
  AL1: seg('Patient Allergy Information', [
    'Set ID - AL1', 'Allergen Type Code', 'Allergen Code/Mnemonic/Description', 'Allergy Severity Code',
    'Allergy Reaction Code', 'Identification Date'
  ]),
  DG1: seg('Diagnosis', [
    'Set ID - DG1', 'Diagnosis Coding Method', 'Diagnosis Code - DG1', 'Diagnosis Description',
    'Diagnosis Date/Time', 'Diagnosis Type', 'Major Diagnostic Category', 'Diagnostic Related Group',
    'DRG Approval Indicator', 'DRG Grouper Review Code', 'Outlier Type', 'Outlier Days', 'Outlier Cost',
    'Grouper Version And Type', 'Diagnosis Priority', 'Diagnosing Clinician', 'Diagnosis Classification',
    'Confidential Indicator', 'Attestation Date/Time', 'Diagnosis Identifier', 'Diagnosis Action Code'
  ]),
  IN1: seg('Insurance', [
    'Set ID - IN1', 'Insurance Plan ID', 'Insurance Company ID', 'Insurance Company Name',
    'Insurance Company Address', 'Insurance Co Contact Person', 'Insurance Co Phone Number', 'Group Number',
    'Group Name', "Insured's Group Emp ID", "Insured's Group Emp Name", 'Plan Effective Date',
    'Plan Expiration Date', 'Authorization Information', 'Plan Type', 'Name Of Insured',
    "Insured's Relationship To Patient", "Insured's Date Of Birth", "Insured's Address",
    'Assignment Of Benefits', 'Coordination Of Benefits', 'Coord Of Ben. Priority', 'Notice Of Admission Flag',
    'Notice Of Admission Date', 'Report Of Eligibility Flag', 'Report Of Eligibility Date',
    'Release Information Code', 'Pre-Admit Cert (PAC)', 'Verification Date/Time', 'Verification By',
    'Type Of Agreement Code', 'Billing Status', 'Lifetime Reserve Days', 'Delay Before L.R. Day',
    'Company Plan Code', 'Policy Number', 'Policy Deductible', 'Policy Limit - Amount', 'Policy Limit - Days',
    'Room Rate - Semi-Private', 'Room Rate - Private', "Insured's Employment Status",
    "Insured's Administrative Sex", "Insured's Employer's Address", 'Verification Status',
    'Prior Insurance Plan ID', 'Coverage Type', 'Handicap', "Insured's ID Number", 'Signature Code',
    'Signature Code Date', "Insured's Birth Place", 'VIP Indicator'
  ]),
  GT1: seg('Guarantor', [
    'Set ID - GT1', 'Guarantor Number', 'Guarantor Name', 'Guarantor Spouse Name', 'Guarantor Address',
    'Guarantor Ph Num - Home', 'Guarantor Ph Num - Business', 'Guarantor Date/Time Of Birth',
    'Guarantor Administrative Sex', 'Guarantor Type', 'Guarantor Relationship', 'Guarantor SSN',
    'Guarantor Date - Begin', 'Guarantor Date - End', 'Guarantor Priority', 'Guarantor Employer Name',
    'Guarantor Employer Address', 'Guarantor Employer Phone Number', 'Guarantor Employee ID Number',
    'Guarantor Employment Status', 'Guarantor Organization Name', 'Guarantor Billing Hold Flag',
    'Guarantor Credit Rating Code', 'Guarantor Death Date And Time', 'Guarantor Death Flag',
    'Guarantor Charge Adjustment Code', 'Guarantor Household Annual Income', 'Guarantor Household Size',
    'Guarantor Employer ID Number', 'Guarantor Marital Status Code', 'Guarantor Hire Effective Date',
    'Employment Stop Date', 'Living Dependency', 'Ambulatory Status', 'Citizenship', 'Primary Language',
    'Living Arrangement', 'Publicity Code', 'Protection Indicator', 'Student Indicator', 'Religion',
    "Mother's Maiden Name", 'Nationality', 'Ethnic Group', "Contact Person's Name",
    "Contact Person's Telephone Number", 'Contact Reason', 'Contact Relationship', 'Job Title',
    'Job Code/Class', "Guarantor Employer's Organization Name", 'Handicap', 'Job Status',
    'Guarantor Financial Class', 'Guarantor Race'
  ]),
  SCH: seg('Scheduling Activity Information', [
    'Placer Appointment ID', 'Filler Appointment ID', 'Occurrence Number', 'Placer Group Number', 'Schedule ID',
    'Event Reason', 'Appointment Reason', 'Appointment Type', 'Appointment Duration',
    'Appointment Duration Units', 'Appointment Timing Quantity', 'Placer Contact Person',
    'Placer Contact Phone Number', 'Placer Contact Address', 'Placer Contact Location', 'Filler Contact Person',
    'Filler Contact Phone Number', 'Filler Contact Address', 'Filler Contact Location', 'Entered By Person',
    'Entered By Phone Number', 'Entered By Location', 'Parent Placer Appointment ID',
    'Parent Filler Appointment ID', 'Filler Status Code', 'Placer Order Number', 'Filler Order Number'
  ]),
  TQ1: seg('Timing/Quantity', [
    'Set ID - TQ1', 'Quantity', 'Repeat Pattern', 'Explicit Time', 'Relative Time and Units',
    'Service Duration', 'Start date/time', 'End date/time', 'Priority', 'Condition text', 'Text instruction',
    'Conjunction', 'Occurrence duration', 'Total occurrences'
  ]),
  SPM: seg('Specimen', [
    'Set ID - SPM', 'Specimen ID', 'Specimen Parent IDs', 'Specimen Type', 'Specimen Type Modifier',
    'Specimen Additives', 'Specimen Collection Method', 'Specimen Source Site', 'Specimen Source Site Modifier',
    'Specimen Collection Site', 'Specimen Role', 'Specimen Collection Amount', 'Grouped Specimen Count',
    'Specimen Description', 'Specimen Handling Code', 'Specimen Risk Code', 'Specimen Collection Date/Time',
    'Specimen Received Date/Time', 'Specimen Expiration Date/Time', 'Specimen Availability',
    'Specimen Reject Reason', 'Specimen Quality', 'Specimen Appropriateness', 'Specimen Condition',
    'Specimen Current Quantity', 'Number of Specimen Containers', 'Container Type', 'Container Condition',
    'Specimen Child Role'
  ]),
  FT1: seg('Financial Transaction', [
    'Set ID - FT1', 'Transaction ID', 'Transaction Batch ID', 'Transaction Date', 'Transaction Posting Date',
    'Transaction Type', 'Transaction Code', 'Transaction Description', 'Transaction Description - Alt',
    'Transaction Quantity', 'Transaction Amount - Extended', 'Transaction Amount - Unit', 'Department Code',
    'Insurance Plan ID', 'Insurance Amount', 'Assigned Patient Location', 'Fee Schedule', 'Patient Type',
    'Diagnosis Code - FT1', 'Performed By Code', 'Ordered By Code', 'Unit Cost', 'Filler Order Number',
    'Entered By Code', 'Procedure Code', 'Procedure Code Modifier'
  ]),
  PR1: seg('Procedures', [
    'Set ID - PR1', 'Procedure Coding Method', 'Procedure Code', 'Procedure Description', 'Procedure Date/Time',
    'Procedure Functional Type', 'Procedure Minutes', 'Anesthesiologist', 'Anesthesia Code',
    'Anesthesia Minutes', 'Surgeon', 'Procedure Practitioner', 'Consent Code', 'Procedure Priority',
    'Associated Diagnosis Code', 'Procedure Code Modifier', 'Procedure DRG Type', 'Tissue Type Code',
    'Procedure Identifier', 'Procedure Action Code'
  ]),
  RXE: seg('Pharmacy/Treatment Encoded Order', [
    'Quantity/Timing', 'Give Code', 'Give Amount - Minimum', 'Give Amount - Maximum', 'Give Units',
    'Give Dosage Form', "Provider's Administration Instructions", 'Deliver-To Location', 'Substitution Status',
    'Dispense Amount', 'Dispense Units', 'Number Of Refills', "Ordering Provider's DEA Number",
    "Pharmacist/Treatment Supplier's Verifier ID", 'Prescription Number', 'Number of Refills Remaining',
    'Number of Refills/Doses Dispensed', 'D/T of Most Recent Refill or Dose Dispensed', 'Total Daily Dose',
    'Needs Human Review', "Pharmacy/Treatment Supplier's Special Dispensing Instructions",
    'Give Per (Time Unit)', 'Give Rate Amount', 'Give Rate Units', 'Give Strength', 'Give Strength Units',
    'Give Indication', 'Dispense Package Size', 'Dispense Package Size Unit', 'Dispense Package Method',
    'Supplementary Code', 'Original Order Date/Time', 'Give Drug Strength Volume',
    'Give Drug Strength Volume Units', 'Controlled Substance Schedule', 'Formulary Status',
    'Pharmaceutical Substance Alternative', 'Pharmacy of Most Recent Fill', 'Initial Dispense Amount',
    'Dispensing Pharmacy', 'Dispensing Pharmacy Address', 'Deliver-to Patient Location', 'Deliver-to Address',
    'Pharmacy Order Type'
  ]),
  RXA: seg('Pharmacy/Treatment Administration', [
    'Give Sub-ID Counter', 'Administration Sub-ID Counter', 'Date/Time Start of Administration',
    'Date/Time End of Administration', 'Administered Code', 'Administered Amount', 'Administered Units',
    'Administered Dosage Form', 'Administration Notes', 'Administering Provider', 'Administered-at Location',
    'Administered Per (Time Unit)', 'Administered Strength', 'Administered Strength Units',
    'Substance Lot Number', 'Substance Expiration Date', 'Substance Manufacturer Name',
    'Substance/Treatment Refusal Reason', 'Indication', 'Completion Status', 'Action Code - RXA',
    'System Entry Date/Time'
  ]),
  RXR: seg('Pharmacy/Treatment Route', [
    'Route', 'Administration Site', 'Administration Device', 'Administration Method', 'Routing Instruction',
    'Administration Site Modifier'
  ]),
  TXA: seg('Transcription Document Header', [
    'Set ID - TXA', 'Document Type', 'Document Content Presentation', 'Activity Date/Time',
    'Primary Activity Provider Code/Name', 'Origination Date/Time', 'Transcription Date/Time', 'Edit Date/Time',
    'Originator Code/Name', 'Assigned Document Authenticator', 'Transcriptionist Code/Name',
    'Unique Document Number', 'Parent Document Number', 'Placer Order Number', 'Filler Order Number',
    'Unique Document File Name', 'Document Completion Status', 'Document Confidentiality Status',
    'Document Availability Status', 'Document Storage Status', 'Document Change Reason',
    'Authentication Person, Time Stamp', 'Distributed Copies (Code and Name of Recipients)'
  ]),
  QPD: seg('Query Parameter Definition', [
    'Message Query Name', 'Query Tag', 'User Parameters (in successive fields)'
  ]),
  RCP: seg('Response Control Parameter', [
    'Query Priority', 'Quantity Limited Request', 'Response Modality', 'Execution and Delivery Time',
    'Modify Indicator', 'Sort-by Field', 'Segment group inclusion'
  ]),
  QAK: seg('Query Acknowledgment', [
    'Query Tag', 'Query Response Status', 'Message Query Name', 'Hit Count', 'This payload', 'Hits remaining'
  ]),
  DSC: seg('Continuation Pointer', [
    'Continuation Pointer', 'Continuation Style'
  ]),
  SFT: seg('Software Segment', [
    'Software Vendor Organization', 'Software Certified Version or Release Number', 'Software Product Name',
    'Software Binary ID', 'Software Product Information', 'Software Install Date'
  ]),
  MRG: seg('Merge Patient Information', [
    'Prior Patient Identifier List', 'Prior Alternate Patient ID', 'Prior Patient Account Number',
    'Prior Patient ID', 'Prior Visit Number', 'Prior Alternate Visit ID', 'Prior Patient Name'
  ]),
  ROL: seg('Role', [
    'Role Instance ID', 'Action Code', 'Role-ROL', 'Role Person', 'Role Begin Date/Time', 'Role End Date/Time',
    'Role Duration', 'Role Action Reason', 'Provider Type', 'Organization Unit Type',
    'Office/Home Address/Birthplace', 'Phone'
  ]),
  AIS: seg('Appointment Information - Service', [
    'Set ID - AIS', 'Segment Action Code', 'Universal Service Identifier', 'Start Date/Time',
    'Start Date/Time Offset', 'Start Date/Time Offset Units', 'Duration', 'Duration Units',
    'Allow Substitution Code', 'Filler Status Code', 'Placer Supplemental Service Information',
    'Filler Supplemental Service Information'
  ]),
  AIG: seg('Appointment Information - General Resource', [
    'Set ID - AIG', 'Segment Action Code', 'Resource ID', 'Resource Type', 'Resource Group',
    'Resource Quantity', 'Resource Quantity Units', 'Start Date/Time', 'Start Date/Time Offset',
    'Start Date/Time Offset Units', 'Duration', 'Duration Units', 'Allow Substitution Code',
    'Filler Status Code'
  ]),
  AIL: seg('Appointment Information - Location Resource', [
    'Set ID - AIL', 'Segment Action Code', 'Location Resource ID', 'Location Type - AIL', 'Location Group',
    'Start Date/Time', 'Start Date/Time Offset', 'Start Date/Time Offset Units', 'Duration', 'Duration Units',
    'Allow Substitution Code', 'Filler Status Code'
  ]),
  AIP: seg('Appointment Information - Personnel Resource', [
    'Set ID - AIP', 'Segment Action Code', 'Personnel Resource ID', 'Resource Type', 'Resource Group',
    'Start Date/Time', 'Start Date/Time Offset', 'Start Date/Time Offset Units', 'Duration', 'Duration Units',
    'Allow Substitution Code', 'Filler Status Code'
  ]),
  RGS: seg('Resource Group', [
    'Set ID - RGS', 'Segment Action Code', 'Resource Group ID'
  ])
};

export const MESSAGE_TYPES = {
  'ACK': 'General acknowledgment message',
  'ADT^A01': 'Admit/visit notification',
  'ADT^A02': 'Transfer a patient',
  'ADT^A03': 'Discharge/end visit',
  'ADT^A04': 'Register a patient',
  'ADT^A05': 'Pre-admit a patient',
  'ADT^A06': 'Change an outpatient to an inpatient',
  'ADT^A07': 'Change an inpatient to an outpatient',
  'ADT^A08': 'Update patient information',
  'ADT^A09': 'Patient departing, tracking',
  'ADT^A10': 'Patient arriving, tracking',
  'ADT^A11': 'Cancel admit/visit notification',
  'ADT^A12': 'Cancel transfer',
  'ADT^A13': 'Cancel discharge/end visit',
  'ADT^A14': 'Pending admit',
  'ADT^A15': 'Pending transfer',
  'ADT^A16': 'Pending discharge',
  'ADT^A17': 'Swap patients',
  'ADT^A18': 'Merge patient information',
  'ADT^A20': 'Bed status update',
  'ADT^A21': 'Patient goes on a leave of absence',
  'ADT^A22': 'Patient returns from a leave of absence',
  'ADT^A23': 'Delete a patient record',
  'ADT^A24': 'Link patient information',
  'ADT^A25': 'Cancel pending discharge',
  'ADT^A26': 'Cancel pending transfer',
  'ADT^A27': 'Cancel pending admit',
  'ADT^A28': 'Add person information',
  'ADT^A29': 'Delete person information',
  'ADT^A30': 'Merge person information',
  'ADT^A31': 'Update person information',
  'ADT^A32': 'Cancel patient arriving, tracking',
  'ADT^A33': 'Cancel patient departing, tracking',
  'ADT^A34': 'Merge patient information, patient ID only',
  'ADT^A35': 'Merge patient information, account number only',
  'ADT^A36': 'Merge patient information, patient ID and account number',
  'ADT^A37': 'Unlink patient information',
  'ADT^A38': 'Cancel pre-admit',
  'ADT^A39': 'Merge person, patient ID',
  'ADT^A40': 'Merge patient, patient identifier list',
  'ADT^A41': 'Merge account, patient account number',
  'ADT^A42': 'Merge visit, visit number',
  'ADT^A43': 'Move patient information, patient identifier list',
  'ADT^A44': 'Move account information, patient account number',
  'ADT^A45': 'Move visit information, visit number',
  'ADT^A46': 'Change patient ID',
  'ADT^A47': 'Change patient identifier list',
  'ADT^A48': 'Change alternate patient ID',
  'ADT^A49': 'Change patient account number',
  'ADT^A50': 'Change visit number',
  'ADT^A51': 'Change alternate visit ID',
  'ADT^A52': 'Cancel leave of absence for a patient',
  'ADT^A53': 'Cancel patient returns from a leave of absence',
  'ADT^A54': 'Change attending doctor',
  'ADT^A55': 'Cancel change attending doctor',
  'ADT^A60': 'Update adverse reaction information',
  'ADT^A61': 'Change consulting doctor',
  'ADT^A62': 'Cancel change consulting doctor',
  'ADR^A19': 'Patient query response',
  'QRY^A19': 'Patient query',
  'QRY^Q01': 'Query sent for immediate response',
  'QRY^Q02': 'Query sent for deferred response',
  'QRY^R02': 'Query for results of observation',
  'QBP^Q11': 'Query by parameter requesting a segment pattern response',
  'QBP^Q13': 'Query by parameter requesting a tabular response',
  'QBP^Q15': 'Query by parameter requesting a display response',
  'QBP^Q21': 'Get person demographics',
  'QBP^Q22': 'Find candidates',
  'QBP^Q23': 'Get corresponding identifiers',
  'QBP^Q24': 'Allocate identifiers',
  'QBP^Q25': 'Personnel information by segment',
  'QBP^Q31': 'Dispense history',
  'QBP^Z73': 'Information about phone and address (custom)',
  'RSP^K11': 'Segment pattern response',
  'RSP^K13': 'Tabular response',
  'RSP^K15': 'Display response',
  'RSP^K21': 'Get person demographics response',
  'RSP^K22': 'Find candidates response',
  'RSP^K23': 'Get corresponding identifiers response',
  'RSP^K24': 'Allocate identifiers response',
  'RSP^K25': 'Personnel information by segment response',
  'RSP^K31': 'Dispense history response',
  'QCK^Q02': 'Query general acknowledgment (deferred)',
  'QCN^J01': 'Cancel query/acknowledge message',
  'QSB^Q16': 'Create subscription',
  'QVR^Q17': 'Query for previous events',
  'ORM^O01': 'Order message',
  'ORR^O02': 'Order response',
  'OMG^O19': 'General clinical order',
  'ORG^O20': 'General clinical order response',
  'OML^O21': 'Laboratory order',
  'ORL^O22': 'Laboratory order response',
  'OML^O33': 'Laboratory order for multiple orders related to a single specimen',
  'ORL^O34': 'Laboratory order response (single specimen)',
  'OML^O35': 'Laboratory order for multiple orders related to a single container of a specimen',
  'ORL^O36': 'Laboratory order response (single container)',
  'OMD^O03': 'Dietary order',
  'ORD^O04': 'Dietary order acknowledgment',
  'OMS^O05': 'Stock requisition order',
  'ORS^O06': 'Stock requisition order acknowledgment',
  'OMN^O07': 'Non-stock requisition order',
  'ORN^O08': 'Non-stock requisition order acknowledgment',
  'OMP^O09': 'Pharmacy/treatment order',
  'ORP^O10': 'Pharmacy/treatment order acknowledgment',
  'OMI^O23': 'Imaging order',
  'ORI^O24': 'Imaging order response',
  'RDE^O11': 'Pharmacy/treatment encoded order',
  'RRE^O12': 'Pharmacy/treatment encoded order acknowledgment',
  'RDS^O13': 'Pharmacy/treatment dispense',
  'RRD^O14': 'Pharmacy/treatment dispense acknowledgment',
  'RGV^O15': 'Pharmacy/treatment give',
  'RRG^O16': 'Pharmacy/treatment give acknowledgment',
  'RAS^O17': 'Pharmacy/treatment administration',
  'RRA^O18': 'Pharmacy/treatment administration acknowledgment',
  'RDE^O25': 'Pharmacy/treatment refill authorization request',
  'RRE^O26': 'Pharmacy/treatment refill authorization acknowledgment',
  'ORU^R01': 'Unsolicited transmission of an observation message',
  'ORU^R30': 'Unsolicited point-of-care observation message without existing order',
  'ORU^R31': 'Unsolicited new point-of-care observation message, search for an order',
  'ORU^R32': 'Unsolicited pre-ordered point-of-care observation',
  'ORF^R04': 'Response to query, transmission of requested observation',
  'OUL^R21': 'Unsolicited laboratory observation',
  'OUL^R22': 'Unsolicited specimen oriented observation message',
  'OUL^R23': 'Unsolicited specimen container oriented observation message',
  'OUL^R24': 'Unsolicited order oriented observation message',
  'SIU^S12': 'Notification of new appointment booking',
  'SIU^S13': 'Notification of appointment rescheduling',
  'SIU^S14': 'Notification of appointment modification',
  'SIU^S15': 'Notification of appointment cancellation',
  'SIU^S16': 'Notification of appointment discontinuation',
  'SIU^S17': 'Notification of appointment deletion',
  'SIU^S18': 'Notification of addition of service/resource on appointment',
  'SIU^S19': 'Notification of modification of service/resource on appointment',
  'SIU^S20': 'Notification of cancellation of service/resource on appointment',
  'SIU^S21': 'Notification of discontinuation of service/resource on appointment',
  'SIU^S22': 'Notification of deletion of service/resource on appointment',
  'SIU^S23': 'Notification of blocked schedule time slot(s)',
  'SIU^S24': 'Notification of opened (unblocked) schedule time slot(s)',
  'SIU^S26': 'Notification that patient did not show up for scheduled appointment',
  'SRM^S01': 'Request new appointment booking',
  'SRM^S02': 'Request appointment rescheduling',
  'SRM^S03': 'Request appointment modification',
  'SRM^S04': 'Request appointment cancellation',
  'SRR^S01': 'Scheduled request response, new appointment booking',
  'SRR^S02': 'Scheduled request response, appointment rescheduling',
  'SRR^S03': 'Scheduled request response, appointment modification',
  'SRR^S04': 'Scheduled request response, appointment cancellation',
  'MDM^T01': 'Original document notification',
  'MDM^T02': 'Original document notification and content',
  'MDM^T03': 'Document status change notification',
  'MDM^T04': 'Document status change notification and content',
  'MDM^T05': 'Document addendum notification',
  'MDM^T06': 'Document addendum notification and content',
  'MDM^T07': 'Document edit notification',
  'MDM^T08': 'Document edit notification and content',
  'MDM^T09': 'Document replacement notification',
  'MDM^T10': 'Document replacement notification and content',
  'MDM^T11': 'Document cancel notification',
  'DFT^P03': 'Post detail financial transaction',
  'DFT^P11': 'Post detail financial transactions, expanded',
  'BAR^P01': 'Add patient accounts',
  'BAR^P02': 'Purge patient accounts',
  'BAR^P05': 'Update account',
  'BAR^P06': 'End account',
  'BAR^P10': 'Transmit ambulatory payment classification (APC) groups',
  'BAR^P12': 'Update diagnosis/procedure',
  'VXQ^V01': 'Query for vaccination record',
  'VXX^V02': 'Response to vaccination query returning multiple PID matches',
  'VXR^V03': 'Vaccination record response',
  'VXU^V04': 'Unsolicited vaccination record update',
  'MFN^M01': 'Master file not otherwise specified',
  'MFN^M02': 'Master file, staff practitioner',
  'MFN^M03': 'Master file, test/observation',
  'MFN^M04': 'Master file, charge description',
  'MFN^M05': 'Patient location master file',
  'MFN^M06': 'Clinical study with phases and schedules master file',
  'MFN^M07': 'Clinical study without phases but with schedules master file',
  'MFN^M08': 'Test/observation (numeric) master file',
  'MFN^M09': 'Test/observation (categorical) master file',
  'MFN^M10': 'Test/observation batteries master file',
  'MFN^M11': 'Test/calculated observations master file',
  'MFN^M12': 'Master file notification message',
  'MFN^M13': 'Master file notification, general',
  'MFN^M15': 'Inventory item master file notification',
  'MFK^M01': 'Master file application acknowledgment',
  'MFQ^M01': 'Master files query',
  'MFR^M01': 'Master files response',
  'PPR^PC1': 'Problem add',
  'PPR^PC2': 'Problem update',
  'PPR^PC3': 'Problem delete',
  'PGL^PC6': 'Goal add',
  'PGL^PC7': 'Goal update',
  'PGL^PC8': 'Goal delete',
  'PPP^PCB': 'Pathway (problem-oriented) add',
  'REF^I12': 'Patient referral',
  'REF^I13': 'Modify patient referral',
  'REF^I14': 'Cancel patient referral',
  'REF^I15': 'Request patient referral status',
  'RRI^I12': 'Return referral information',
  'RRI^I13': 'Return referral information (modify)',
  'RRI^I14': 'Return referral information (cancel)',
  'RRI^I15': 'Return referral information (status)',
  'RQI^I01': 'Request for insurance information',
  'RQI^I02': 'Request/receipt of patient selection display list',
  'RQI^I03': 'Request/receipt of patient selection list',
  'RPI^I01': 'Return patient information',
  'RQA^I08': 'Request for treatment authorization information',
  'RPA^I08': 'Return patient authorization',
  'CRM^C01': 'Register a patient on a clinical trial',
  'CRM^C02': 'Cancel a patient registration on clinical trial',
  'CSU^C09': 'Automated time intervals for reporting, like monthly',
  'NMQ^N01': 'Application management query message',
  'NMR^N01': 'Application management response message',
  'NMD^N02': 'Application management data message (unsolicited)',
  'PMU^B01': 'Add personnel record',
  'PMU^B02': 'Update personnel record',
  'PMU^B03': 'Delete personnel record',
  'PMU^B04': 'Active practicing person',
  'PMU^B05': 'Deactivate practicing person',
  'PMU^B06': 'Terminate practicing person',
  'SSU^U03': 'Specimen status update',
  'SSR^U04': 'Specimen status request',
  'ESU^U01': 'Automated equipment status update',
  'ESR^U02': 'Automated equipment status request',
  'INU^U05': 'Automated equipment inventory update',
  'INR^U06': 'Automated equipment inventory request',
  'EAC^U07': 'Automated equipment command',
  'EAR^U08': 'Automated equipment response',
  'EAN^U09': 'Automated equipment notification',
  'TCU^U10': 'Automated equipment test code settings update',
  'TCR^U11': 'Automated equipment test code settings request',
  'LSU^U12': 'Automated equipment log/service update',
  'LSR^U13': 'Automated equipment log/service request',
  'EDR^R07': 'Enhanced display response',
  'ERP^R09': 'Event replay response',
  'EQQ^Q04': 'Embedded query language query',
  'RQQ^Q09': 'Event replay query',
  'SPQ^Q08': 'Stored procedure request',
  'TBR^R08': 'Tabular data response',
  'UDM^Q05': 'Unsolicited display update message',
  'VQQ^Q07': 'Virtual table query',
  'RQC^I05': 'Request for patient clinical information',
  'RQC^I06': 'Request/receipt of clinical data listing',
  'RQP^I04': 'Request for patient demographic data',
  'RCI^I05': 'Return clinical information',
  'RCL^I06': 'Return clinical list'
};

export const ACK_CODES = {
  AA: 'Application Accept',
  AE: 'Application Error',
  AR: 'Application Reject',
  CA: 'Commit Accept',
  CE: 'Commit Error',
  CR: 'Commit Reject'
};

export function segmentName(segment) {
  if (typeof segment !== 'string') return 'Unknown segment';
  const key = segment.trim().toUpperCase();
  const def = SEGMENTS[key];
  if (def) return def.name;
  if (/^Z[A-Z0-9]{2}$/.test(key)) return 'Custom Z segment';
  return 'Unknown segment';
}

export function fieldName(segment, n) {
  const key = typeof segment === 'string' ? segment.trim().toUpperCase() : String(segment);
  const index = Number(n);
  const def = SEGMENTS[key];
  if (def && Number.isInteger(index) && index > 0 && index < def.fields.length && def.fields[index]) {
    return def.fields[index];
  }
  if (key === 'QPD' && Number.isInteger(index) && index > 3) return 'User Parameters';
  return `${key}-${n}`;
}

// Field names for a whole segment as a plain array (fields[0] = ''), used by the UI tree.
export function fieldNames(segment) {
  const key = typeof segment === 'string' ? segment.trim().toUpperCase() : '';
  const def = SEGMENTS[key];
  return def ? def.fields.slice() : [''];
}

// Human description of a message type, e.g. ('ADT', 'A01') or ('ADT^A01'). '' when unknown.
export function describeMessageType(messageType, triggerEvent = '') {
  if (typeof messageType !== 'string' || !messageType) return '';
  let type = messageType.trim().toUpperCase();
  let trigger = typeof triggerEvent === 'string' ? triggerEvent.trim().toUpperCase() : '';
  if (type.includes('^')) {
    const parts = type.split('^');
    type = parts[0];
    if (!trigger) trigger = parts[1] || '';
  }
  if (trigger && MESSAGE_TYPES[`${type}^${trigger}`]) return MESSAGE_TYPES[`${type}^${trigger}`];
  if (type === 'ACK') return MESSAGE_TYPES.ACK;
  if (MESSAGE_TYPES[type]) return MESSAGE_TYPES[type];
  return '';
}

export function ackCodeName(code) {
  if (typeof code !== 'string') return '';
  return ACK_CODES[code.trim().toUpperCase()] || '';
}
