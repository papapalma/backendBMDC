import { NextResponse } from 'next/server';
import { ApiResponse, PaginatedResponse } from '@/types';

export const successResponse = <T>(
  data: T,
  message?: string,
  status: number = 200
): NextResponse<ApiResponse<T>> => {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
    },
    { status }
  );
};

export const errorResponse = (
  error: string,
  status: number = 400
): NextResponse<ApiResponse> => {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    { status }
  );
};

export const paginatedResponse = <T>(
  data: T[],
  page: number,
  limit: number,
  total: number
): NextResponse<PaginatedResponse<T>> => {
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
};

export const createdResponse = <T>(
  data: T,
  message: string = 'Resource created successfully'
): NextResponse<ApiResponse<T>> => {
  return successResponse(data, message, 201);
};

export const noContentResponse = (): NextResponse => {
  return new NextResponse(null, { status: 204 });
};

export const unauthorizedResponse = (
  message: string = 'Unauthorized'
): NextResponse<ApiResponse> => {
  return errorResponse(message, 401);
};

export const forbiddenResponse = (
  message: string = 'Forbidden'
): NextResponse<ApiResponse> => {
  return errorResponse(message, 403);
};

export const notFoundResponse = (
  message: string = 'Resource not found'
): NextResponse<ApiResponse> => {
  return errorResponse(message, 404);
};

export const validationErrorResponse = (
  errors: Record<string, string[]>
): NextResponse<ApiResponse> => {
  return NextResponse.json(
    {
      success: false,
      error: 'Validation failed',
      errors,
    },
    { status: 422 }
  );
};

export const serverErrorResponse = (
  message: string = 'Internal server error'
): NextResponse<ApiResponse> => {
  return errorResponse(message, 500);
};
