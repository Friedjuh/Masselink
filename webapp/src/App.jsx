import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import {
  BriefcaseBusiness,
  Download,
  FileText,
  LoaderCircle,
  LogOut,
  Save,
  Settings,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import './App.css'

const STORAGE_KEYS = {
  customers: 'masselink-customers',
  projects: 'masselink-projects',
  invoiceDraft: 'masselink-invoice-draft',
  settings: 'masselink-settings',
}

const DEFAULT_MECHANIC = 'Barry'
const SHARED_WORKSPACE_ID = 'masselink'
const TOP_LOGO_SRC = '/pdf-logo-sharp.png'
const BOTTOM_LOGO_SRC = '/pdf-logo-sharp.png'

const FIXED_ITEM_DEFINITIONS = [
  { key: 'hours', label: 'Uren', unit: 'uur', defaultQuantity: '', defaultRate: '50' },
  { key: 'travelHours', label: 'Reistijd', unit: 'uur', defaultQuantity: '', defaultRate: '40' },
  { key: 'kilometers', label: 'Gereden kilometers', unit: 'km', defaultQuantity: '', defaultRate: '0.49' },
  { key: 'otherCosts', label: 'Overige kosten', unit: 'post', defaultQuantity: '', defaultRate: '0' },
]

const INVOICE_STATUS_OPTIONS = [
  { value: 'verzonden', label: 'Verzonden' },
  { value: 'betaald', label: 'Betaald' },
]

const defaultSettings = {
  businessName: 'Masselink Montage',
  addressLine1: 'Holterweg 181',
  postalCode: '7003DP',
  city: 'Doetinchem',
  defaultHoursRate: '50',
  defaultTravelHoursRate: '40',
  defaultKilometersRate: '0.49',
  iban: 'NL13ABNA0977379892',
  kvkNumber: '09160275',
  vatNumber: 'NL001865615B44',
  phone: '06-51162290',
  email: 'barrymasselink1@hotmail.com',
  footerNote:
    'Wij verzoeken u het bovenstaande bedrag over te maken op bank nr. NL13 ABNA0977379892 onder vermelding van het bovenstaande factuurnummer.',
}

const tabs = [
  { id: 'customers', label: 'Klanten', icon: Users },
  { id: 'projects', label: 'Projecten', icon: BriefcaseBusiness },
  { id: 'invoices', label: 'Facturen', icon: FileText },
  { id: 'history', label: 'Historie', icon: FileText },
  { id: 'settings', label: 'Bedrijf', icon: Settings },
]

const imageCache = {}

function safeStorageGet(key, fallback) {
  try {
    const saved = window.localStorage.getItem(key)
    if (!saved) {
      return fallback
    }
    return JSON.parse(saved)
  } catch {
    return fallback
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function createId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function numberValue(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(numberValue(value))
}

function formatDisplayDate(value) {
  if (!value) {
    return '-'
  }
  return new Intl.DateTimeFormat('nl-NL').format(new Date(value))
}

function formatDecimal(value) {
  const numericValue = numberValue(value)
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue)
}

function formatQuantity(value) {
  const numericValue = numberValue(value)
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numericValue)
}

function createPdfFilename(invoice) {
  const safeInvoiceNumber = (invoice.invoiceNumber || 'zonder-nummer').replace(/[^\w.-]+/g, '-')
  const safeDate = (invoice.invoiceDate || 'zonder-datum').replace(/[^\d-]+/g, '-')
  return 'factuur-' + safeInvoiceNumber + '-' + safeDate + '.pdf'
}

function isMissingRelationError(error, relationName) {
  if (!error) {
    return false
  }
  const message = String(error.message || '')
  return message.includes('Could not find the table') && message.includes(relationName)
}

function createEmptyCustomer() {
  return {
    id: '',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    vatNumber: '',
    addressLine1: '',
    postalCode: '',
    city: '',
  }
}

function createEmptyProject() {
  return {
    id: '',
    customerId: '',
    projectNumber: '',
    projectName: '',
  }
}

function createDefaultItems(settings = defaultSettings) {
  const items = {}
  for (let index = 0; index < FIXED_ITEM_DEFINITIONS.length; index += 1) {
    const definition = FIXED_ITEM_DEFINITIONS[index]
    let rate = definition.defaultRate
    if (definition.key === 'hours') {
      rate = settings.defaultHoursRate
    } else if (definition.key === 'travelHours') {
      rate = settings.defaultTravelHoursRate
    } else if (definition.key === 'kilometers') {
      rate = settings.defaultKilometersRate
    }
    items[definition.key] = {
      quantity: definition.defaultQuantity,
      rate,
    }
  }
  return items
}

function createEmptyInvoice(settings = defaultSettings) {
  return {
    id: '',
    customerId: '',
    projectIds: [],
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    week: '',
    mechanic: DEFAULT_MECHANIC,
    workDescription: '',
    sent: false,
    reverseVat: true,
    notes: '',
    items: createDefaultItems(settings),
  }
}

function normalizeCustomers(records) {
  const input = Array.isArray(records) ? records : []
  return input.map((record) => ({
    id: record.id || createId('customer'),
    companyName: record.companyName || '',
    contactName: record.contactName || '',
    email: record.email || '',
    phone: record.phone || '',
    vatNumber: record.vatNumber || '',
    addressLine1: record.addressLine1 || '',
    postalCode: record.postalCode || '',
    city: record.city || '',
  }))
}

function normalizeProjects(records) {
  const input = Array.isArray(records) ? records : []
  return input.map((record) => ({
    id: record.id || createId('project'),
    customerId: record.customerId || '',
    projectNumber: record.projectNumber || '',
    projectName: record.projectName || '',
  }))
}

function normalizeItems(items, settings = defaultSettings) {
  const normalized = createDefaultItems(settings)
  const source = items && typeof items === "object" ? items : {}
  for (let index = 0; index < FIXED_ITEM_DEFINITIONS.length; index += 1) {
    const definition = FIXED_ITEM_DEFINITIONS[index]
    const currentItem = source[definition.key] || {}
    normalized[definition.key] = {
      quantity:
        currentItem.quantity !== undefined
          ? String(currentItem.quantity)
          : definition.defaultQuantity,
      rate:
        currentItem.rate !== undefined ? String(currentItem.rate) : normalized[definition.key].rate,
    }
  }
  return normalized
}

function normalizeInvoice(record, settings = defaultSettings) {
  if (!record || typeof record !== 'object') {
    return createEmptyInvoice(settings)
  }

  return {
    id: record.id || '',
    customerId: record.customerId || '',
    projectIds: Array.isArray(record.projectIds)
      ? record.projectIds.filter(Boolean).slice(0, 5)
      : record.projectId
        ? [record.projectId]
        : [],
    invoiceNumber: record.invoiceNumber || '',
    invoiceDate: record.invoiceDate || new Date().toISOString().slice(0, 10),
    week: record.week || '',
    mechanic: record.mechanic || DEFAULT_MECHANIC,
    workDescription: record.workDescription || record.notes || '',
    sent: typeof record.sent === 'boolean' ? record.sent : false,
    reverseVat: record.reverseVat !== false,
    notes: record.notes || '',
    items: normalizeItems(record.items, settings),
  }
}

function normalizeSettings(record) {
  return { ...defaultSettings, ...(record || {}) }
}

function hasUntouchedInvoiceFields(invoice) {
  if (!invoice || invoice.id) {
    return false
  }

  return !(
    invoice.customerId ||
    invoice.projectIds.length > 0 ||
    invoice.invoiceNumber ||
    invoice.week ||
    invoice.workDescription ||
    invoice.mechanic !== DEFAULT_MECHANIC ||
    invoice.sent ||
    invoice.reverseVat !== true ||
    invoice.notes
  )
}

function areInvoiceItemsDefault(invoice, settings = defaultSettings) {
  const defaultInvoice = createEmptyInvoice(settings)
  return JSON.stringify(defaultInvoice.items) === JSON.stringify(invoice.items)
}

function isNewInvoiceDraft(invoice, settings = defaultSettings) {
  return hasUntouchedInvoiceFields(invoice) && areInvoiceItemsDefault(invoice, settings)
}

function isInvoiceReady(invoice) {
  return Boolean(
    invoice.customerId &&
      invoice.projectIds.length > 0 &&
      invoice.invoiceNumber &&
      invoice.invoiceDate &&
      invoice.week &&
      invoice.mechanic,
  )
}

function findById(records, id) {
  for (let index = 0; index < records.length; index += 1) {
    if (records[index].id === id) {
      return records[index]
    }
  }
  return null
}

function getInvoiceRows(invoice) {
  const rows = []
  for (let index = 0; index < FIXED_ITEM_DEFINITIONS.length; index += 1) {
    const definition = FIXED_ITEM_DEFINITIONS[index]
    const currentItem = invoice.items[definition.key] || {}
    const quantity = numberValue(currentItem.quantity)
    const rate = numberValue(currentItem.rate)
    const total =
      definition.key === 'otherCosts' && currentItem.quantity === ''
        ? rate
        : quantity * rate
    if (quantity !== 0 || rate !== 0) {
      rows.push({
        key: definition.key,
        label: definition.label,
        unit: definition.unit,
        quantity,
        rawQuantity: currentItem.quantity || '',
        rate,
        rawRate: currentItem.rate || '',
        total,
      })
    }
  }
  return rows
}

function getFixedInvoiceRows(invoice) {
  return FIXED_ITEM_DEFINITIONS.map((definition) => {
    const currentItem = invoice.items[definition.key] || {}
    const quantity = currentItem.quantity || ''
    const rate = currentItem.rate || ''
    let total = numberValue(quantity) * numberValue(rate)
    if (definition.key === 'otherCosts' && quantity === '' && numberValue(rate) !== 0) {
      total = numberValue(rate)
    }
    return {
      key: definition.key,
      label: definition.label,
      quantity,
      rate,
      total,
    }
  })
}

function getInvoiceTotal(invoice) {
  const rows = getInvoiceRows(invoice)
  let total = 0
  for (let index = 0; index < rows.length; index += 1) {
    total += rows[index].total
  }
  return total
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function loadImageAsDataUrl(src) {
  if (imageCache[src]) {
    return imageCache[src]
  }

  imageCache[src] = new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }
      context.drawImage(image, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => resolve(null)
    image.src = src
  })

  return imageCache[src]
}

async function createInvoicePdf(invoice, customer, project, settings) {
  const [topLogo, bottomLogo] = await Promise.all([
    loadImageAsDataUrl(TOP_LOGO_SRC),
    loadImageAsDataUrl(BOTTOM_LOGO_SRC),
  ])

  const rows = getFixedInvoiceRows(invoice)
  const selectedProjects = Array.isArray(project) ? project : project ? [project] : []
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({
    title: createPdfFilename(invoice),
    subject: 'Factuur ' + (invoice.invoiceNumber || ''),
    author: settings.businessName,
    creator: settings.businessName,
  })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Factuur', 16, 17)

  if (topLogo) {
    doc.addImage(topLogo, 'PNG', 120, 6, 69, 20)
  }

  doc.setFontSize(11)
  doc.text(customer ? customer.companyName : '-', 16, 28)
  doc.text(customer ? customer.addressLine1 : '-', 16, 34)
  doc.text(
    [customer ? customer.postalCode : '', customer ? customer.city : ''].filter(Boolean).join(' ') ||
      '-',
    16,
    40,
  )
  doc.text('BTW Nr: ' + (customer && customer.vatNumber ? customer.vatNumber : '-'), 16, 46)

  doc.text('Factuurnummer:', 122, 37)
  doc.text(invoice.invoiceNumber, 190, 37, { align: 'right' })
  doc.text('Factuurdatum:', 122, 43)
  doc.text(formatDisplayDate(invoice.invoiceDate), 190, 43, { align: 'right' })

  const infoTop = 54
  const infoRowHeight = 8.5
  const workDescriptionWidth = 104
  const workDescriptionText = invoice.workDescription || '-'
  const workDescriptionLines = doc.splitTextToSize(workDescriptionText, workDescriptionWidth)
  const workDescriptionLineHeight = 5
  const workDescriptionPaddingTop = 4
  const workDescriptionPaddingBottom = 2
  const workDescriptionHeight = Math.max(
    infoRowHeight,
    workDescriptionPaddingTop +
      workDescriptionLines.length * workDescriptionLineHeight +
      workDescriptionPaddingBottom,
  )
  const infoHeight = infoRowHeight * 7 + workDescriptionHeight
  const infoWidth = 148
  const infoRight = 16 + infoWidth
  doc.rect(16, infoTop, infoWidth, infoHeight)
  doc.line(52, infoTop, 52, infoTop + infoHeight)
  for (let lineIndex = 1; lineIndex < 7; lineIndex += 1) {
    doc.line(52, infoTop + lineIndex * infoRowHeight, infoRight, infoTop + lineIndex * infoRowHeight)
  }
  const workDescriptionTop = infoTop + infoRowHeight * 7
  doc.line(52, workDescriptionTop, infoRight, workDescriptionTop)

  doc.text('Week:', 19, 61)
  doc.text('Project(en):', 19, 69.5)
  doc.text('Monteur:', 19, 112)
  doc.text('Werkzaamheden:', 19, workDescriptionTop + 7)

  doc.text(invoice.week || '-', 56, 61)
  for (let index = 0; index < 5; index += 1) {
    const selectedProject = selectedProjects[index]
    const projectLine = selectedProject
      ? [selectedProject.projectNumber, selectedProject.projectName].filter(Boolean).join(' ')
      : ''
    if (projectLine) {
      const line = doc.splitTextToSize(projectLine, 104)[0]
      doc.text(line, 56, 69.5 + index * infoRowHeight)
    }
  }
  doc.text(invoice.mechanic || DEFAULT_MECHANIC, 56, 112)
  workDescriptionLines.forEach((line, index) => {
    doc.text(line, 56, workDescriptionTop + workDescriptionPaddingTop + 3 + index * workDescriptionLineHeight)
  })

  const tableTop = infoTop + infoHeight + 8
  const tableLeft = 16
  const col1 = 87
  const col2 = 31
  const col3 = 30
  const col4 = 26
  const headerHeight = 9
  const itemRowHeight = 11
  const totalRowHeight = itemRowHeight
  const x1 = tableLeft
  const x2 = x1 + col1
  const x3 = x2 + col2
  const x4 = x3 + col3

  doc.rect(x1, tableTop, col1, headerHeight)
  doc.rect(x2, tableTop, col2, headerHeight)
  doc.rect(x3, tableTop, col3, headerHeight)
  doc.rect(x4, tableTop, col4, headerHeight)

  doc.text('Omschrijving', 19, tableTop + 6)
  doc.text('Aantal', x2 + col2 / 2, tableTop + 6, { align: 'center' })
  doc.text('Prijs', x3 + col3 / 2, tableTop + 6, { align: 'center' })
  doc.text('Totaal', x4 + col4 / 2, tableTop + 6, { align: 'center' })

  rows.forEach((row, index) => {
    const rowTop = tableTop + headerHeight + index * itemRowHeight
    const baseline = rowTop + 7
    doc.rect(x1, rowTop, col1, itemRowHeight)
    doc.rect(x2, rowTop, col2, itemRowHeight)
    doc.rect(x3, rowTop, col3, itemRowHeight)
    doc.rect(x4, rowTop, col4, itemRowHeight)
    doc.text(row.label, 19, baseline)

    if (row.key === 'otherCosts') {
      if (row.total !== 0 || row.rate !== '') {
        doc.text(money(row.total), x4 + col4 / 2, baseline, { align: 'center' })
      }
      return
    }

    if (row.quantity !== '') {
      doc.text(formatQuantity(row.quantity), x2 + col2 / 2, baseline, { align: 'center' })
    }
    if (row.rate !== '') {
      doc.text(formatDecimal(row.rate), x3 + col3 / 2, baseline, { align: 'center' })
    }
    if (row.total !== 0 || row.rate !== '' || row.quantity !== '') {
      doc.text(money(row.total), x4 + col4 / 2, baseline, { align: 'center' })
    }
  })

  const totalTop = tableTop + headerHeight + rows.length * itemRowHeight
  doc.rect(x1, totalTop, col1 + col2 + col3, totalRowHeight)
  doc.rect(x4, totalTop, col4, totalRowHeight)
  doc.text('Totaal door u te voldoen', 19, totalTop + 7)
  doc.text(money(getInvoiceTotal(invoice)), x4 + col4 / 2, totalTop + 7, { align: 'center' })

  if (invoice.reverseVat) {
    doc.text('BTW verlegd', 16, totalTop + 16)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const pageHeight = doc.internal.pageSize.getHeight()
  const footerStart = totalTop + 28
  doc.text(settings.footerNote, 16, footerStart, { maxWidth: 174 })
  doc.text('Betalingstermijn uiterlijk 30 dagen na factuurdatum', 16, footerStart + 11)
  doc.text('Reclamaties 10 dagen na factuurdatum', 16, footerStart + 18)
  const footerBottomBaseline = Math.max(footerStart + 64, pageHeight - 10)
  const footerRightTop = footerBottomBaseline - 37
  const footerLeftTop = footerBottomBaseline - 31

  if (bottomLogo) {
    doc.addImage(bottomLogo, 'PNG', 14, footerLeftTop, 48, 14)
  }

  doc.text(settings.addressLine1, 16, footerLeftTop + 19)
  doc.text(settings.postalCode + ' ' + settings.city, 16, footerLeftTop + 25)
  doc.text('Tel: ' + settings.phone, 16, footerLeftTop + 31)
  doc.text('IBAN: ' + settings.iban, 118, footerRightTop + 19)
  doc.text('KvK nummer: ' + settings.kvkNumber, 118, footerRightTop + 25)
  doc.text('BTW nummer: ' + settings.vatNumber, 118, footerRightTop + 31)
  doc.text('E-mail: ' + settings.email, 118, footerRightTop + 37)

  return doc
}

function mapCustomerRow(row) {
  return normalizeCustomers([
    {
      id: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      email: row.email,
      phone: row.phone,
      vatNumber: row.vat_number,
      addressLine1: row.address_line1,
      postalCode: row.postal_code,
      city: row.city,
    },
  ])[0]
}

function mapProjectRow(row) {
  return normalizeProjects([
    {
      id: row.id,
      customerId: row.customer_id,
      projectNumber: row.project_number,
      projectName: row.project_name,
    },
  ])[0]
}

function mapInvoiceHistoryRow(row) {
  const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {}
  const snapshotInvoice = snapshot.invoice && typeof snapshot.invoice === 'object' ? snapshot.invoice : {}
  const projectLabels = Array.isArray(row.project_labels)
    ? row.project_labels
    : Array.isArray(snapshot.projectsSnapshot)
      ? snapshot.projectsSnapshot.map((project) =>
          [project.projectNumber, project.projectName].filter(Boolean).join(' '),
        )
      : []

  return {
    id: row.id,
    customerId: row.customer_id || snapshotInvoice.customerId || '',
    customerName: row.customer_name || snapshot.customerSnapshot?.companyName || '',
    customerEmail: row.customer_email || snapshot.customerSnapshot?.email || '',
    invoiceNumber: row.invoice_number || snapshotInvoice.invoiceNumber || '',
    invoiceDate: row.invoice_date || snapshotInvoice.invoiceDate || '',
    projectLabels,
    projectIds: Array.isArray(snapshotInvoice.projectIds) ? snapshotInvoice.projectIds : [],
    status: row.status || 'concept',
    revision: Number(row.revision) || 1,
    totalAmount: numberValue(row.total_amount),
    lastPdfAt: row.last_pdf_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    snapshot,
  }
}

function toCustomerPayload(customer, ownerId) {
  return {
    id: customer.id || createId('customer'),
    owner_id: ownerId,
    workspace_id: SHARED_WORKSPACE_ID,
    company_name: customer.companyName.trim(),
    contact_name: customer.contactName.trim(),
    email: customer.email.trim(),
    phone: customer.phone.trim(),
    vat_number: customer.vatNumber.trim(),
    address_line1: customer.addressLine1.trim(),
    postal_code: customer.postalCode.trim(),
    city: customer.city.trim(),
  }
}

function toProjectPayload(project, ownerId) {
  return {
    id: project.id || createId('project'),
    owner_id: ownerId,
    workspace_id: SHARED_WORKSPACE_ID,
    customer_id: project.customerId,
    project_number: project.projectNumber.trim(),
    project_name: project.projectName.trim(),
  }
}

function createInvoiceHistorySnapshot(invoice, customer, projects, settings) {
  return {
    invoice: normalizeInvoice(invoice, settings),
    customerSnapshot: customer
      ? {
          id: customer.id,
          companyName: customer.companyName,
          contactName: customer.contactName,
          email: customer.email,
          phone: customer.phone,
          vatNumber: customer.vatNumber,
          addressLine1: customer.addressLine1,
          postalCode: customer.postalCode,
          city: customer.city,
        }
      : null,
    projectsSnapshot: projects.map((project) => ({
      id: project.id,
      customerId: project.customerId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
    })),
    settingsSnapshot: normalizeSettings(settings),
  }
}

function createInvoiceHistoryPayload(invoice, customer, projects, settings, ownerId, existingRecord) {
  const id = invoice.id || existingRecord?.id || createId('invoice')
  const snapshot = createInvoiceHistorySnapshot({ ...invoice, id }, customer, projects, settings)
  const previousSnapshot = existingRecord?.snapshot || null
  const snapshotChanged = JSON.stringify(snapshot) !== JSON.stringify(previousSnapshot)
  const nextStatus = 'verzonden'
  const nextRevision = existingRecord ? (snapshotChanged ? existingRecord.revision + 1 : existingRecord.revision) : 1

  return {
    payload: {
      id,
      owner_id: ownerId,
      workspace_id: SHARED_WORKSPACE_ID,
      customer_id: customer?.id || invoice.customerId || null,
      customer_name: customer?.companyName || '',
      customer_email: customer?.email || '',
      invoice_number: invoice.invoiceNumber,
      invoice_date: invoice.invoiceDate,
      project_labels: projects.map((project) =>
        [project.projectNumber, project.projectName].filter(Boolean).join(' '),
      ),
      status: nextStatus,
      revision: nextRevision,
      total_amount: Number(getInvoiceTotal(invoice).toFixed(2)),
      last_pdf_at: new Date().toISOString(),
      snapshot,
    },
    nextStatus,
    nextRevision,
    snapshotChanged,
  }
}

function invoiceFromHistory(record, settings) {
  const snapshotInvoice = record?.snapshot?.invoice || null
  if (!snapshotInvoice) {
    return createEmptyInvoice(settings)
  }
  return normalizeInvoice(
    {
      ...snapshotInvoice,
      id: record.id,
      sent: record.status === 'verzonden' || record.status === 'betaald',
    },
    settings,
  )
}

function invoiceStatusLabel(status) {
  const option = INVOICE_STATUS_OPTIONS.find((item) => item.value === status)
  return option ? option.label : status
}

function confirmDelete(message) {
  if (typeof window === 'undefined') {
    return true
  }
  return window.confirm(message)
}

function hasMeaningfulDraft(invoice, settings) {
  return !isNewInvoiceDraft(normalizeInvoice(invoice, settings), settings)
}

function hasMeaningfulSettings(settings) {
  return JSON.stringify(normalizeSettings(settings)) !== JSON.stringify(defaultSettings)
}

function getLegacyDraft(settings) {
  const rawDraft = safeStorageGet(STORAGE_KEYS.invoiceDraft, null)
  return normalizeInvoice(rawDraft, settings)
}

async function fetchRemoteData(userId) {
  const [settingsResult, customersResult, projectsResult, draftResult, invoicesResult] = await Promise.all([
    supabase.from('app_settings').select('settings').eq('owner_id', userId).maybeSingle(),
    supabase.from('customers').select('*').eq('workspace_id', SHARED_WORKSPACE_ID).order('company_name'),
    supabase.from('projects').select('*').eq('workspace_id', SHARED_WORKSPACE_ID).order('project_number'),
    supabase.from('invoice_drafts').select('draft').eq('owner_id', userId).maybeSingle(),
    supabase.from('invoices').select('*').eq('workspace_id', SHARED_WORKSPACE_ID).order('invoice_date', { ascending: false }),
  ])

  if (settingsResult.error) {
    throw settingsResult.error
  }
  if (customersResult.error) {
    throw customersResult.error
  }
  if (projectsResult.error) {
    throw projectsResult.error
  }
  if (draftResult.error && !isMissingRelationError(draftResult.error, 'invoice_drafts')) {
    throw draftResult.error
  }
  if (invoicesResult.error && !isMissingRelationError(invoicesResult.error, 'invoices')) {
    throw invoicesResult.error
  }

  return {
    settingsRow: settingsResult.data,
    customers: customersResult.data.map(mapCustomerRow),
    projects: projectsResult.data.map(mapProjectRow),
    draftRow: draftResult.data || null,
    invoices: (invoicesResult.data || []).map(mapInvoiceHistoryRow),
    missingDraftTable: Boolean(
      draftResult.error && isMissingRelationError(draftResult.error, 'invoice_drafts'),
    ),
    missingInvoicesTable: Boolean(
      invoicesResult.error && isMissingRelationError(invoicesResult.error, 'invoices'),
    ),
  }
}

async function migrateLegacyDataIfNeeded(userId, remoteData) {
  const localSettings = normalizeSettings(safeStorageGet(STORAGE_KEYS.settings, defaultSettings))
  const localCustomers = normalizeCustomers(safeStorageGet(STORAGE_KEYS.customers, []))
  const localProjects = normalizeProjects(safeStorageGet(STORAGE_KEYS.projects, []))
  const localDraft = getLegacyDraft(localSettings)
  let changed = false

  if (!remoteData.settingsRow) {
    const { error } = await supabase.from('app_settings').upsert(
      {
        owner_id: userId,
        settings: hasMeaningfulSettings(localSettings) ? localSettings : defaultSettings,
      },
      { onConflict: 'owner_id' },
    )
    if (error) {
      throw error
    }
    changed = true
  }

  if (remoteData.customers.length === 0 && localCustomers.length > 0) {
    const { error } = await supabase
      .from('customers')
      .upsert(localCustomers.map((customer) => toCustomerPayload(customer, userId)))
    if (error) {
      throw error
    }
    changed = true
  }

  if (remoteData.projects.length === 0 && localProjects.length > 0) {
    const { error } = await supabase
      .from('projects')
      .upsert(localProjects.map((project) => toProjectPayload(project, userId)))
    if (error) {
      throw error
    }
    changed = true
  }

  if (
    !remoteData.missingDraftTable &&
    !remoteData.draftRow &&
    hasMeaningfulDraft(localDraft, localSettings)
  ) {
    const { error } = await supabase.from('invoice_drafts').upsert(
      {
        owner_id: userId,
        draft: localDraft,
      },
      { onConflict: 'owner_id' },
    )
    if (error) {
      throw error
    }
    changed = true
  }

  return changed
}

function App() {
  const [activeTab, setActiveTab] = useState('customers')
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [customers, setCustomers] = useState([])
  const [projects, setProjects] = useState([])
  const [invoiceHistory, setInvoiceHistory] = useState([])
  const [settings, setSettings] = useState(defaultSettings)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [customerForm, setCustomerForm] = useState(createEmptyCustomer)
  const [projectForm, setProjectForm] = useState(createEmptyProject)
  const [invoiceForm, setInvoiceForm] = useState(createEmptyInvoice(defaultSettings))
  const [projectPickerId, setProjectPickerId] = useState('')
  const [loadingData, setLoadingData] = useState(false)
  const [missingInvoicesTable, setMissingInvoicesTable] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const draftSnapshotRef = useRef('')

  const filteredProjects = useMemo(
    () => projects.filter((project) => project.customerId === invoiceForm.customerId),
    [projects, invoiceForm.customerId],
  )
  const invoiceReady = useMemo(() => isInvoiceReady(invoiceForm), [invoiceForm])

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setAuthReady(true)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return
      }
      setSession(data.session)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setCustomers([])
      setProjects([])
      setInvoiceHistory([])
      setSettings(defaultSettings)
      setSettingsDirty(false)
      setCustomerForm(createEmptyCustomer())
      setProjectForm(createEmptyProject())
      setInvoiceForm(createEmptyInvoice(defaultSettings))
      setProjectPickerId('')
      setMissingInvoicesTable(false)
      draftSnapshotRef.current = ''
      return
    }

    let cancelled = false

    async function loadAppData() {
      setLoadingData(true)
      setErrorMessage('')
      try {
        let remoteData = await fetchRemoteData(session.user.id)
        const migrated = await migrateLegacyDataIfNeeded(session.user.id, remoteData)
        if (migrated) {
          remoteData = await fetchRemoteData(session.user.id)
        }

        if (cancelled) {
          return
        }

        const normalizedSettings = normalizeSettings(remoteData.settingsRow?.settings)
        const normalizedDraft = normalizeInvoice(remoteData.draftRow?.draft, normalizedSettings)

        setSettings(normalizedSettings)
        setSettingsDirty(false)
        setCustomers(remoteData.customers)
        setProjects(remoteData.projects)
        setInvoiceHistory(remoteData.invoices)
        setCustomerForm(createEmptyCustomer())
        setProjectForm(createEmptyProject())
        setInvoiceForm(normalizedDraft)
        setProjectPickerId('')
        setMissingInvoicesTable(remoteData.missingInvoicesTable)
        draftSnapshotRef.current = JSON.stringify(normalizedDraft)
        if (remoteData.missingInvoicesTable) {
          setStatusMessage(
            'De tabel invoices ontbreekt nog in Supabase. Downloaden werkt wel, maar factuurhistorie nog niet. Voer eerst de bijgewerkte schema.sql uit.',
          )
        } else if (remoteData.missingDraftTable) {
          setStatusMessage(
            'De tabel invoice_drafts ontbreekt nog in Supabase. Klanten en projecten werken al, maar het factuurconcept wordt nog lokaal bewaard tot die tabel is aangemaakt.',
          )
        } else {
          setStatusMessage(migrated ? 'Lokale gegevens zijn naar Supabase overgezet.' : '')
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error.message || 'Het laden van de data uit Supabase is mislukt.')
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false)
        }
      }
    }

    loadAppData()

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    safeStorageSet(STORAGE_KEYS.customers, customers)
  }, [customers])

  useEffect(() => {
    safeStorageSet(STORAGE_KEYS.projects, projects)
  }, [projects])

  useEffect(() => {
    safeStorageSet(STORAGE_KEYS.settings, settings)
  }, [settings])

  useEffect(() => {
    safeStorageSet(STORAGE_KEYS.invoiceDraft, invoiceForm)
  }, [invoiceForm])

  useEffect(() => {
    if (!session || loadingData) {
      return
    }

    const snapshot = JSON.stringify(invoiceForm)
    if (snapshot === draftSnapshotRef.current) {
      return
    }

    const timer = window.setTimeout(async () => {
      try {
        const { error } = await supabase.from('invoice_drafts').upsert(
          {
            owner_id: session.user.id,
            draft: invoiceForm,
          },
          { onConflict: 'owner_id' },
        )
        if (error) {
          if (isMissingRelationError(error, 'invoice_drafts')) {
            draftSnapshotRef.current = snapshot
            setStatusMessage(
              'De tabel invoice_drafts ontbreekt nog in Supabase. Het factuurconcept blijft voorlopig alleen lokaal op dit toestel bewaard.',
            )
            return
          }
          throw error
        }
        draftSnapshotRef.current = snapshot
      } catch (error) {
        setErrorMessage(error.message || 'Conceptfactuur kon niet worden opgeslagen.')
      }
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [invoiceForm, loadingData, session])

  useEffect(() => {
    if (!hasUntouchedInvoiceFields(invoiceForm)) {
      return
    }

    const currentDefaultItems = createDefaultItems(settings)
    const currentDefaultSnapshot = JSON.stringify(currentDefaultItems)
    const currentInvoiceSnapshot = JSON.stringify(invoiceForm.items)
    if (currentDefaultSnapshot === currentInvoiceSnapshot) {
      return
    }

    setInvoiceForm((currentInvoice) => ({
      ...currentInvoice,
      items: createDefaultItems(settings),
    }))
  }, [invoiceForm, settings])

  function resetCustomerForm() {
    setCustomerForm(createEmptyCustomer())
  }

  function resetProjectForm() {
    setProjectForm(createEmptyProject())
  }

  function setStatus(text) {
    setStatusMessage(text)
    setErrorMessage('')
  }

  function setError(text) {
    setErrorMessage(text)
    setStatusMessage('')
  }

  function handleInvoiceCustomerChange(customerId) {
    setInvoiceForm((currentInvoice) => ({
      ...currentInvoice,
      customerId,
      projectIds: [],
    }))
    setProjectPickerId('')
  }

  function addProjectToInvoice() {
    if (!projectPickerId || invoiceForm.projectIds.includes(projectPickerId)) {
      return
    }
    if (invoiceForm.projectIds.length >= 5) {
      setError('Een factuur kan maximaal 5 projecten bevatten.')
      return
    }
    setInvoiceForm((currentInvoice) => ({
      ...currentInvoice,
      projectIds: [...currentInvoice.projectIds, projectPickerId],
    }))
    setProjectPickerId('')
  }

  function removeProjectFromInvoice(projectId) {
    setInvoiceForm((currentInvoice) => ({
      ...currentInvoice,
      projectIds: currentInvoice.projectIds.filter((id) => id !== projectId),
    }))
  }

  function updateInvoiceItem(key, field, value) {
    setInvoiceForm((currentInvoice) => ({
      ...currentInvoice,
      items: {
        ...currentInvoice.items,
        [key]: {
          ...currentInvoice.items[key],
          [field]: value,
        },
      },
    }))
  }

  async function saveCustomer(event) {
    event.preventDefault()
    if (!session) {
      return
    }
    if (!customerForm.companyName.trim()) {
      setError('Vul minimaal de bedrijfsnaam van de klant in.')
      return
    }

    setBusyAction('customer')
    try {
      const payload = toCustomerPayload(customerForm, session.user.id)
      const { data, error } = await supabase
        .from('customers')
        .upsert(payload)
        .select()
        .single()
      if (error) {
        throw error
      }

      const savedCustomer = mapCustomerRow(data)
      setCustomers((currentCustomers) => {
        const nextCustomers = currentCustomers.filter((customer) => customer.id !== savedCustomer.id)
        return [...nextCustomers, savedCustomer].sort((left, right) =>
          left.companyName.localeCompare(right.companyName),
        )
      })
      setCustomerForm(createEmptyCustomer())
      setStatus('Klant opgeslagen.')
    } catch (error) {
      setError(error.message || 'Klant kon niet worden opgeslagen.')
    } finally {
      setBusyAction('')
    }
  }

  async function saveProject(event) {
    event.preventDefault()
    if (!session) {
      return
    }
    if (!projectForm.customerId || !projectForm.projectNumber.trim() || !projectForm.projectName.trim()) {
      setError('Vul klant, projectnummer en projectnaam in.')
      return
    }

    setBusyAction('project')
    try {
      const payload = toProjectPayload(projectForm, session.user.id)
      const { data, error } = await supabase
        .from('projects')
        .upsert(payload)
        .select()
        .single()
      if (error) {
        throw error
      }

      const savedProject = mapProjectRow(data)
      setProjects((currentProjects) => {
        const nextProjects = currentProjects.filter((project) => project.id !== savedProject.id)
        return [...nextProjects, savedProject].sort((left, right) =>
          left.projectNumber.localeCompare(right.projectNumber),
        )
      })
      setProjectForm(createEmptyProject())
      setStatus('Project opgeslagen.')
    } catch (error) {
      setError(error.message || 'Project kon niet worden opgeslagen.')
    } finally {
      setBusyAction('')
    }
  }

  async function deleteCustomer(customerId) {
    if (!session) {
      return
    }
    if (!confirmDelete('Weet je zeker dat je deze klant wilt verwijderen? Bijbehorende projecten verdwijnen ook.')) {
      return
    }

    setBusyAction('delete-customer')
    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('workspace_id', SHARED_WORKSPACE_ID)
        .eq('id', customerId)
      if (error) {
        throw error
      }

      const projectIdsToRemove = projects
        .filter((project) => project.customerId === customerId)
        .map((project) => project.id)

      setCustomers((currentCustomers) => currentCustomers.filter((customer) => customer.id !== customerId))
      setProjects((currentProjects) =>
        currentProjects.filter((project) => project.customerId !== customerId),
      )
      if (customerForm.id === customerId) {
        setCustomerForm(createEmptyCustomer())
      }
      if (projectForm.customerId === customerId) {
        setProjectForm(createEmptyProject())
      }
      setInvoiceForm((currentInvoice) => ({
        ...currentInvoice,
        customerId: currentInvoice.customerId === customerId ? '' : currentInvoice.customerId,
        projectIds: currentInvoice.projectIds.filter((projectId) => !projectIdsToRemove.includes(projectId)),
      }))
      setStatus('Klant verwijderd.')
    } catch (error) {
      setError(error.message || 'Klant kon niet worden verwijderd.')
    } finally {
      setBusyAction('')
    }
  }

  async function deleteProject(projectId) {
    if (!session) {
      return
    }
    if (!confirmDelete('Weet je zeker dat je dit project wilt verwijderen?')) {
      return
    }

    setBusyAction('delete-project')
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('workspace_id', SHARED_WORKSPACE_ID)
        .eq('id', projectId)
      if (error) {
        throw error
      }

      setProjects((currentProjects) => currentProjects.filter((project) => project.id !== projectId))
      if (projectForm.id === projectId) {
        setProjectForm(createEmptyProject())
      }
      setInvoiceForm((currentInvoice) => ({
        ...currentInvoice,
        projectIds: currentInvoice.projectIds.filter((id) => id !== projectId),
      }))
      if (projectPickerId === projectId) {
        setProjectPickerId('')
      }
      setStatus('Project verwijderd.')
    } catch (error) {
      setError(error.message || 'Project kon niet worden verwijderd.')
    } finally {
      setBusyAction('')
    }
  }

  function resetInvoiceForm(statusText = 'Nieuwe factuur gestart.') {
    const resolvedStatusText =
      typeof statusText === 'string' ? statusText : 'Nieuwe factuur gestart.'
    const nextInvoice = createEmptyInvoice(settings)
    setInvoiceForm(nextInvoice)
    setProjectPickerId('')
    draftSnapshotRef.current = ''
    if (resolvedStatusText) {
      setStatus(resolvedStatusText)
    }
  }

  async function saveSettings() {
    if (!session) {
      return
    }

    setBusyAction('settings')
    try {
      const { error } = await supabase.from('app_settings').upsert(
        {
          owner_id: session.user.id,
          settings,
        },
        { onConflict: 'owner_id' },
      )
      if (error) {
        throw error
      }
      setSettingsDirty(false)
      setStatus('Bedrijfsgegevens opgeslagen.')
    } catch (error) {
      setError(error.message || 'Bedrijfsgegevens konden niet worden opgeslagen.')
    } finally {
      setBusyAction('')
    }
  }

  async function saveInvoiceHistory(customer, selectedProjects) {
    if (!session) {
      return null
    }
    if (missingInvoicesTable) {
      return { missingTable: true }
    }

    const existingRecord = invoiceForm.id
      ? invoiceHistory.find((record) => record.id === invoiceForm.id) || null
      : null
    const { payload, snapshotChanged } = createInvoiceHistoryPayload(
      invoiceForm,
      customer,
      selectedProjects,
      settings,
      session.user.id,
      existingRecord,
    )

    const { data, error } = await supabase
      .from('invoices')
      .upsert(payload)
      .select()
      .single()
    if (error) {
      if (isMissingRelationError(error, 'invoices')) {
        setMissingInvoicesTable(true)
        return { missingTable: true }
      }
      throw error
    }

    const savedRecord = mapInvoiceHistoryRow(data)
      setInvoiceHistory((currentHistory) => {
        const nextHistory = currentHistory.filter((record) => record.id !== savedRecord.id)
        return [savedRecord, ...nextHistory].sort((left, right) => {
          const leftStamp = left.invoiceDate || left.updatedAt
          const rightStamp = right.invoiceDate || right.updatedAt
        return String(rightStamp).localeCompare(String(leftStamp))
      })
    })
      setInvoiceForm((currentInvoice) => ({
        ...currentInvoice,
        id: savedRecord.id,
        sent: savedRecord.status === 'verzonden' || savedRecord.status === 'betaald',
      }))
      return {
        savedRecord,
        snapshotChanged,
      existed: Boolean(existingRecord),
    }
  }

  function openInvoiceFromHistory(record) {
    const nextInvoice = invoiceFromHistory(record, settings)
    setInvoiceForm(nextInvoice)
    setProjectPickerId('')
    setActiveTab('invoices')
    draftSnapshotRef.current = ''
    setStatus('Factuur uit historie geladen. Wijzigingen worden pas vastgelegd bij Download PDF.')
  }

  async function updateInvoiceHistoryStatus(recordId, nextStatus) {
    if (!session || missingInvoicesTable) {
      return
    }

    setBusyAction('invoice-status-' + recordId)
    try {
      const targetRecord = invoiceHistory.find((record) => record.id === recordId)
      if (!targetRecord) {
        return
      }
      const { data, error } = await supabase
        .from('invoices')
        .update({ status: nextStatus })
        .eq('workspace_id', SHARED_WORKSPACE_ID)
        .eq('id', recordId)
        .select()
        .single()
      if (error) {
        throw error
      }

      const savedRecord = mapInvoiceHistoryRow(data)
      setInvoiceHistory((currentHistory) =>
        currentHistory.map((record) => (record.id === savedRecord.id ? savedRecord : record)),
      )
      if (invoiceForm.id === savedRecord.id) {
        setInvoiceForm((currentInvoice) => ({
          ...currentInvoice,
          sent: savedRecord.status === 'verzonden' || savedRecord.status === 'betaald',
        }))
      }
      setStatus('Factuurstatus bijgewerkt naar ' + invoiceStatusLabel(nextStatus).toLowerCase() + '.')
    } catch (error) {
      setError(error.message || 'Factuurstatus kon niet worden bijgewerkt.')
    } finally {
      setBusyAction('')
    }
  }

  async function deleteInvoiceHistory(recordId) {
    if (!session || missingInvoicesTable) {
      return
    }
    if (!confirmDelete('Weet je zeker dat je deze factuur wilt verwijderen?')) {
      return
    }

    setBusyAction('delete-invoice-' + recordId)
    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('workspace_id', SHARED_WORKSPACE_ID)
        .eq('id', recordId)
      if (error) {
        throw error
      }

      setInvoiceHistory((currentHistory) => currentHistory.filter((record) => record.id !== recordId))
      if (invoiceForm.id === recordId) {
        const nextInvoice = createEmptyInvoice(settings)
        setInvoiceForm(nextInvoice)
        draftSnapshotRef.current = ''
        setProjectPickerId('')
      }
      setStatus('Factuur verwijderd.')
    } catch (error) {
      setError(error.message || 'Factuur kon niet worden verwijderd.')
    } finally {
      setBusyAction('')
    }
  }

  async function downloadInvoiceFromHistory(record) {
    const snapshotInvoice = normalizeInvoice(record.snapshot?.invoice, settings)
    const snapshotCustomer = record.snapshot?.customerSnapshot || null
    const snapshotProjects = Array.isArray(record.snapshot?.projectsSnapshot)
      ? record.snapshot.projectsSnapshot
      : []
    const snapshotSettings = normalizeSettings(record.snapshot?.settingsSnapshot || settings)

    setBusyAction('history-pdf-' + record.id)
    try {
      const doc = await createInvoicePdf(
        snapshotInvoice,
        snapshotCustomer,
        snapshotProjects,
        snapshotSettings,
      )
      const blob = doc.output('blob')
      downloadBlob(blob, createPdfFilename(snapshotInvoice))
      setStatus('PDF uit historie gedownload.')
    } catch (error) {
      setError(error.message || 'Historische PDF kon niet worden gemaakt.')
    } finally {
      setBusyAction('')
    }
  }

  async function generateInvoicePdf(event) {
    event.preventDefault()
    if (!invoiceReady) {
      setError('Vul klant, project, factuurnummer, datum, week en monteur in.')
      return
    }

    const customer = findById(customers, invoiceForm.customerId)
    const selectedProjects = invoiceForm.projectIds
      .map((projectId) => findById(projects, projectId))
      .filter(Boolean)

    setBusyAction('pdf')
    try {
      const saveResult = await saveInvoiceHistory(customer, selectedProjects)
      const doc = await createInvoicePdf(invoiceForm, customer, selectedProjects, settings)
      const blob = doc.output('blob')
      downloadBlob(blob, createPdfFilename(invoiceForm))
      if (saveResult?.missingTable) {
        resetInvoiceForm(
          'PDF gedownload. De tabel invoices ontbreekt nog, dus deze factuur staat nog niet in de historie.',
        )
      } else if (saveResult?.existed && saveResult.snapshotChanged) {
        resetInvoiceForm('PDF gedownload. Bestaande factuur in historie bijgewerkt en op verzonden gezet.')
      } else if (saveResult?.existed) {
        resetInvoiceForm('PDF gedownload. Bestaande factuur in historie bijgewerkt.')
      } else {
        resetInvoiceForm('PDF gedownload en aan factuurhistorie toegevoegd als verzonden.')
      }
    } catch (error) {
      setError(error.message || 'PDF kon niet worden gemaakt.')
    } finally {
      setBusyAction('')
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()
    if (!hasSupabaseConfig) {
      return
    }
    if (!authForm.email.trim() || !authForm.password.trim()) {
      setAuthMessage('Vul e-mailadres en wachtwoord in.')
      return
    }

    setAuthBusy(true)
    setAuthMessage('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authForm.email.trim(),
        password: authForm.password,
      })
      if (error) {
        throw error
      }
    } catch (error) {
      setAuthMessage(error.message || 'Aanmelden is mislukt.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOut() {
    if (!hasSupabaseConfig) {
      return
    }
    await supabase.auth.signOut()
    setStatusMessage('')
    setErrorMessage('')
  }

  if (!hasSupabaseConfig) {
    return (
      <div className="app-shell">
        <section className="auth-panel">
          <h1>Supabase configuratie ontbreekt</h1>
          <p>
            Vul in <code>.env.local</code> de variabelen <code>VITE_SUPABASE_URL</code> en{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> in.
          </p>
        </section>
      </div>
    )
  }

  if (!authReady) {
    return (
      <div className="app-shell">
        <section className="auth-panel loading-panel">
          <LoaderCircle className="spin" size={24} />
          <p>Sessie laden...</p>
        </section>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app-shell">
        <section className="auth-panel">
          <h1>Masselink Facturen</h1>
          <p>Log in om klanten, projecten en de conceptfactuur centraal op te slaan.</p>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <Field
              label="E-mail"
              type="email"
              value={authForm.email}
              onChange={(value) => setAuthForm({ ...authForm, email: value })}
            />
            <Field
              label="Wachtwoord"
              type="password"
              value={authForm.password}
              onChange={(value) => setAuthForm({ ...authForm, password: value })}
            />
            {authMessage ? <p className="auth-message">{authMessage}</p> : null}
            <div className="auth-actions">
              <button type="submit" className="primary-button" disabled={authBusy}>
                {authBusy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                Inloggen
              </button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar topbar-split">
        <div>
          <h1>Masselink Facturen</h1>
        </div>
        <div className="session-tools">
          <span className="session-label">{session.user.email}</span>
          <button type="button" className="ghost-button" onClick={signOut}>
            <LogOut size={16} />
            Uitloggen
          </button>
        </div>
      </header>

      {statusMessage ? <NoticeBanner type="success" text={statusMessage} /> : null}
      {errorMessage ? <NoticeBanner type="error" text={errorMessage} /> : null}

      <nav className="tabbar" aria-label="Hoofdmenu">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTab ? 'tab active' : 'tab'}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {loadingData ? (
        <section className="auth-panel loading-panel">
          <LoaderCircle className="spin" size={24} />
          <p>Data laden...</p>
        </section>
      ) : (
        <main className="content-grid">
          {activeTab === 'customers' && (
            <>
              <section className="panel">
                <PanelHeader title="Klant" />
                <form className="form-grid" onSubmit={saveCustomer}>
                  <Field
                    label="Bedrijfsnaam"
                    value={customerForm.companyName}
                    onChange={(value) => setCustomerForm({ ...customerForm, companyName: value })}
                  />
                  <Field
                    label="Contactpersoon"
                    value={customerForm.contactName}
                    onChange={(value) => setCustomerForm({ ...customerForm, contactName: value })}
                  />
                  <Field
                    label="E-mail"
                    type="email"
                    value={customerForm.email}
                    onChange={(value) => setCustomerForm({ ...customerForm, email: value })}
                  />
                  <Field
                    label="Telefoon"
                    value={customerForm.phone}
                    onChange={(value) => setCustomerForm({ ...customerForm, phone: value })}
                  />
                  <Field
                    label="BTW-nummer"
                    value={customerForm.vatNumber}
                    onChange={(value) => setCustomerForm({ ...customerForm, vatNumber: value })}
                  />
                  <Field
                    label="Adres"
                    value={customerForm.addressLine1}
                    onChange={(value) => setCustomerForm({ ...customerForm, addressLine1: value })}
                  />
                  <Field
                    label="Postcode"
                    value={customerForm.postalCode}
                    onChange={(value) => setCustomerForm({ ...customerForm, postalCode: value })}
                  />
                  <Field
                    label="Plaats"
                    value={customerForm.city}
                    onChange={(value) => setCustomerForm({ ...customerForm, city: value })}
                  />
                  <div className="form-actions">
                    <button type="button" className="ghost-button" onClick={resetCustomerForm}>
                      Nieuw
                    </button>
                    <button type="submit" className="primary-button" disabled={busyAction === 'customer'}>
                      {busyAction === 'customer' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                      Opslaan
                    </button>
                  </div>
                </form>
              </section>

              <section className="panel">
                <PanelHeader title="Klantenbestand" />
                <div className="stack">
                  {customers.map((customer) => (
                    <article className="record-card entity-card" key={customer.id}>
                      <div className="entity-card-body">
                        <h3>{customer.companyName}</h3>
                        <p>{[customer.postalCode, customer.addressLine1].filter(Boolean).join(' ')}</p>
                      </div>
                      <div className="card-actions entity-card-actions">
                        <IconButton
                          icon={UserRound}
                          label="Wijzig"
                          onClick={() => setCustomerForm(customer)}
                        />
                        <IconButton
                          icon={Trash2}
                          label="Verwijder"
                          onClick={() => deleteCustomer(customer.id)}
                          disabled={busyAction === 'delete-customer'}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeTab === 'projects' && (
            <>
              <section className="panel">
                <PanelHeader title="Project" />
                <form className="form-grid" onSubmit={saveProject}>
                  <SelectField
                    label="Klant"
                    value={projectForm.customerId}
                    onChange={(value) => setProjectForm({ ...projectForm, customerId: value })}
                    options={customers.map((customer) => ({
                      value: customer.id,
                      label: customer.companyName,
                    }))}
                  />
                  <Field
                    label="Projectnummer"
                    value={projectForm.projectNumber}
                    onChange={(value) => setProjectForm({ ...projectForm, projectNumber: value })}
                  />
                  <Field
                    label="Projectnaam"
                    value={projectForm.projectName}
                    onChange={(value) => setProjectForm({ ...projectForm, projectName: value })}
                  />
                  <div className="form-actions">
                    <button type="button" className="ghost-button" onClick={resetProjectForm}>
                      Nieuw
                    </button>
                    <button type="submit" className="primary-button" disabled={busyAction === 'project'}>
                      {busyAction === 'project' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                      Opslaan
                    </button>
                  </div>
                </form>
              </section>

              <section className="panel">
                <PanelHeader title="Projecten" />
                <div className="stack">
                  {projects.map((project) => (
                    <article className="record-card entity-card" key={project.id}>
                      <div className="entity-card-body">
                        <h3>{[project.projectNumber, project.projectName].filter(Boolean).join(' ')}</h3>
                        <p>{findById(customers, project.customerId)?.companyName || 'Geen klant'}</p>
                      </div>
                      <div className="card-actions entity-card-actions">
                        <IconButton
                          icon={BriefcaseBusiness}
                          label="Wijzig"
                          onClick={() => setProjectForm(project)}
                        />
                        <IconButton
                          icon={Trash2}
                          label="Verwijder"
                          onClick={() => deleteProject(project.id)}
                          disabled={busyAction === 'delete-project'}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeTab === 'invoices' && (
            <section className="panel">
              <PanelHeader title="Factuur" />
              <form className="form-grid" onSubmit={generateInvoicePdf}>
                <Field
                  label="Factuurnummer"
                  value={invoiceForm.invoiceNumber}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, invoiceNumber: value })}
                />
                <Field
                  label="Factuurdatum"
                  type="date"
                  value={invoiceForm.invoiceDate}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, invoiceDate: value })}
                />
                <SelectField
                  label="Klant"
                  value={invoiceForm.customerId}
                  onChange={handleInvoiceCustomerChange}
                  options={customers.map((customer) => ({
                    value: customer.id,
                    label: customer.companyName,
                  }))}
                />
                <SelectField
                  label="Project toevoegen"
                  value={projectPickerId}
                  onChange={setProjectPickerId}
                  options={filteredProjects.map((project) => ({
                    value: project.id,
                    label: [project.projectNumber, project.projectName].filter(Boolean).join(' '),
                  }))}
                  disabled={!invoiceForm.customerId}
                />
                <div className="field add-project-field">
                  <span>Geselecteerde projecten</span>
                  <div className="selected-projects-box">
                    {invoiceForm.projectIds.length === 0 && (
                      <p className="muted-text">Nog geen projecten gekoppeld.</p>
                    )}
                    {invoiceForm.projectIds.map((projectId) => {
                      const project = findById(projects, projectId)
                      if (!project) {
                        return null
                      }
                      return (
                        <div className="selected-project-row" key={project.id}>
                          <span>
                            {[project.projectNumber, project.projectName]
                              .filter(Boolean)
                              .join(' ')}
                          </span>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => removeProjectFromInvoice(project.id)}
                          >
                            <Trash2 size={14} />
                            Verwijder
                          </button>
                        </div>
                      )
                    })}
                    <div className="selected-project-footer">
                      <span>{invoiceForm.projectIds.length} van 5 projecten geselecteerd</span>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={addProjectToInvoice}
                        disabled={
                          !projectPickerId ||
                          invoiceForm.projectIds.includes(projectPickerId) ||
                          invoiceForm.projectIds.length >= 5
                        }
                      >
                        Toevoegen
                      </button>
                    </div>
                  </div>
                </div>
                <Field
                  label="Week"
                  value={invoiceForm.week}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, week: value })}
                />
                <Field
                  label="Monteur"
                  value={invoiceForm.mechanic}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, mechanic: value })}
                />
                <TextAreaField
                  label="Werkzaamheden"
                  value={invoiceForm.workDescription}
                  onChange={(value) => setInvoiceForm({ ...invoiceForm, workDescription: value })}
                />
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={invoiceForm.reverseVat}
                    onChange={(event) =>
                      setInvoiceForm({ ...invoiceForm, reverseVat: event.target.checked })
                    }
                  />
                  <span>BTW verlegd tonen</span>
                </label>

                <div className="line-items">
                  <h3>Factuurregels</h3>
                  {FIXED_ITEM_DEFINITIONS.map((definition) => (
                    <div className="compact-line-row" key={definition.key}>
                      <div className="compact-line-title">
                        <strong>{definition.label}</strong>
                        <span>{definition.unit}</span>
                      </div>
                      <CompactInput
                        label="Aantal"
                        value={invoiceForm.items[definition.key].quantity}
                        onChange={(value) => updateInvoiceItem(definition.key, 'quantity', value)}
                      />
                      <CompactInput
                        label="Prijs"
                        value={invoiceForm.items[definition.key].rate}
                        onChange={(value) => updateInvoiceItem(definition.key, 'rate', value)}
                      />
                    </div>
                  ))}
                </div>

                <div className="form-actions invoice-actions-bar">
                  <div className="invoice-total">
                    <span>Totaal</span>
                    <strong>{money(getInvoiceTotal(invoiceForm))}</strong>
                  </div>
                  <div className="invoice-action-buttons">
                    <button type="button" className="ghost-button" onClick={resetInvoiceForm}>
                      Nieuw
                    </button>
                    <button type="submit" className="primary-button" disabled={!invoiceReady || busyAction === 'pdf'}>
                      {busyAction === 'pdf' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                      Download PDF
                    </button>
                  </div>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'history' && (
            <section className="panel">
              <PanelHeader title="Factuurhistorie" />
              <div className="stack">
                {invoiceHistory.length === 0 ? (
                  <article className="record-card history-card">
                    <div>
                      <h3>Nog geen facturen in historie</h3>
                    </div>
                  </article>
                ) : (
                  invoiceHistory.map((record) => (
                    <article className="record-card history-card" key={record.id}>
                      <div className="history-main">
                        <div className="history-topline">
                          <h3>{record.invoiceNumber || 'Zonder nummer'}</h3>
                          <span>{record.customerName || 'Geen klant'}</span>
                        </div>
                        <div className="history-secondline">
                          <span>{formatDisplayDate(record.invoiceDate)}</span>
                          <strong>{money(record.totalAmount)}</strong>
                        </div>
                      </div>
                      <div className="history-actions">
                        <div className="history-button-row history-button-row-three">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openInvoiceFromHistory(record)}
                            disabled={record.status === 'betaald'}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => downloadInvoiceFromHistory(record)}
                            disabled={busyAction === 'history-pdf-' + record.id}
                          >
                            {busyAction === 'history-pdf-' + record.id ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <Download size={16} />
                            )}
                            PDF
                          </button>
                          <button
                            type="button"
                            className="ghost-button status-action"
                            onClick={() => deleteInvoiceHistory(record.id)}
                            disabled={busyAction === 'delete-invoice-' + record.id}
                          >
                            {busyAction === 'delete-invoice-' + record.id ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <Trash2 size={16} />
                            )}
                            Verwijder
                          </button>
                        </div>
                        <div className="history-button-row">
                          <button
                            type="button"
                            className={
                              record.status === 'verzonden' ? 'primary-button status-action' : 'ghost-button status-action'
                            }
                            onClick={() => updateInvoiceHistoryStatus(record.id, 'verzonden')}
                            disabled={busyAction === 'invoice-status-' + record.id}
                          >
                            {busyAction === 'invoice-status-' + record.id ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <FileText size={16} />
                            )}
                            Verzonden
                          </button>
                          <button
                            type="button"
                            className={
                              record.status === 'betaald' ? 'primary-button status-action' : 'ghost-button status-action'
                            }
                            onClick={() => updateInvoiceHistoryStatus(record.id, 'betaald')}
                            disabled={busyAction === 'invoice-status-' + record.id}
                          >
                            {busyAction === 'invoice-status-' + record.id ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <Save size={16} />
                            )}
                            Betaald
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {activeTab === 'settings' && (
            <section className="panel">
              <PanelHeader title="Bedrijfsgegevens" />
              <div className="form-grid">
                <Field
                  label="Bedrijfsnaam"
                  value={settings.businessName}
                  onChange={(value) => {
                    setSettings({ ...settings, businessName: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Adres"
                  value={settings.addressLine1}
                  onChange={(value) => {
                    setSettings({ ...settings, addressLine1: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Postcode"
                  value={settings.postalCode}
                  onChange={(value) => {
                    setSettings({ ...settings, postalCode: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Plaats"
                  value={settings.city}
                  onChange={(value) => {
                    setSettings({ ...settings, city: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Standaard uurprijs"
                  type="number"
                  value={settings.defaultHoursRate}
                  onChange={(value) => {
                    setSettings({ ...settings, defaultHoursRate: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Standaard reistijd"
                  type="number"
                  value={settings.defaultTravelHoursRate}
                  onChange={(value) => {
                    setSettings({ ...settings, defaultTravelHoursRate: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Standaard km-prijs"
                  type="number"
                  value={settings.defaultKilometersRate}
                  onChange={(value) => {
                    setSettings({ ...settings, defaultKilometersRate: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="IBAN"
                  value={settings.iban}
                  onChange={(value) => {
                    setSettings({ ...settings, iban: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="KvK-nummer"
                  value={settings.kvkNumber}
                  onChange={(value) => {
                    setSettings({ ...settings, kvkNumber: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="BTW-nummer"
                  value={settings.vatNumber}
                  onChange={(value) => {
                    setSettings({ ...settings, vatNumber: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="Telefoon"
                  value={settings.phone}
                  onChange={(value) => {
                    setSettings({ ...settings, phone: value })
                    setSettingsDirty(true)
                  }}
                />
                <Field
                  label="E-mail"
                  type="email"
                  value={settings.email}
                  onChange={(value) => {
                    setSettings({ ...settings, email: value })
                    setSettingsDirty(true)
                  }}
                />
                <TextAreaField
                  label="Voettekst"
                  value={settings.footerNote}
                  onChange={(value) => {
                    setSettings({ ...settings, footerNote: value })
                    setSettingsDirty(true)
                  }}
                />
                <div className="form-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={saveSettings}
                    disabled={!settingsDirty || busyAction === 'settings'}
                  >
                    {busyAction === 'settings' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                    Opslaan
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      )}
    </div>
  )
}

function NoticeBanner({ type, text }) {
  return <div className={type === 'error' ? 'notice error' : 'notice success'}>{text}</div>
}

function PanelHeader({ title, description }) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, disabled }) {
  return (
    <button type="button" className="ghost-button" onClick={onClick} disabled={disabled}>
      <Icon size={16} />
      {label}
    </button>
  )
}

function Field({ label, value, onChange, type = 'text', disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function CompactInput({ label, value, onChange }) {
  return (
    <label className="compact-input">
      <span>{label}</span>
      <input type="number" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function TextAreaField({ label, value, onChange }) {
  return (
    <label className="field field-full">
      <span>{label}</span>
      <textarea rows="3" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Kies...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default App
