// controllers/archive.controller.js
import ArchiveService from '../services/archive.service.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';

/**
 * Get archived content by date
 * Query: date=2026-05-01
 */
export async function getArchiveByDate(req, res) {
  const { date } = req.query;

  if (!date) {
    throw new ApiError(400, 'Date parameter is required (format: YYYY-MM-DD)');
  }

  const archived = await ArchiveService.getArchiveByDate(date);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        date,
        count: archived.length,
        data: archived
      },
      `${archived.length} archived content found for ${date}`
    )
  );
}

/**
 * Get archived content by date range
 * Query: startDate=2026-05-01&endDate=2026-05-07
 */
export async function getArchiveByDateRange(req, res) {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    throw new ApiError(400, 'Both startDate and endDate parameters are required');
  }

  const archived = await ArchiveService.getArchiveByDateRange(startDate, endDate);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        range: { startDate, endDate },
        count: archived.length,
        data: archived
      },
      `${archived.length} archived content found in range`
    )
  );
}
